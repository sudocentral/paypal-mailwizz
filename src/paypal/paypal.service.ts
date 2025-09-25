import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { normalizeName } from '../utils/normalize';
import { SyncQueueService } from '../queue/sync-queue.service';

@Injectable()
export class PaypalService {
  constructor(
    @Inject('PG_CONNECTION') private readonly db: Pool,
    private readonly mailwizzService: MailWizzService,
    private readonly syncQueue: SyncQueueService,
  ) {}

  /**
   * Unified webhook entrypoint.
   * Supports:
   *  - REST: PAYMENT.CAPTURE.COMPLETED (payload.event_type)
   *  - IPN: web_accept + payment_status=Completed (payload.txn_type)
   */
  async processWebhook(payload: any) {
    const isRest = !!payload?.event_type;
    const isIpn  = !!payload?.txn_type || !!payload?.payment_status;

    if (!isRest && !isIpn) {
      Logger.log('ℹ️ Unknown PayPal webhook shape; ignoring.', 'PaypalService');
      return;
    }

    if (isRest) {
      await this.handleRestCaptureCompleted(payload);
      return;
    }

    if (isIpn) {
      await this.handleIpn(payload);
      return;
    }
  }

  // -------------------- REST --------------------
  private async handleRestCaptureCompleted(payload: any) {
    const eventType = payload.event_type;
    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      Logger.log(`ℹ️ Ignoring REST event type: ${eventType}`, 'PaypalService');
      return;
    }

    const resource = payload.resource;
    const email = resource?.payer?.email_address;
    if (!email) {
      Logger.warn('⚠️ REST webhook missing email, skipping.', 'PaypalService');
      return;
    }

    const rawFirst = resource?.payer?.name?.given_name || '';
    const rawLast  = resource?.payer?.name?.surname || '';
    const rawName  = `${rawFirst} ${rawLast}`.trim();
    const { first: preferredFirst, last: preferredLast } = normalizeName(rawName, email);

    const donationAmount = parseFloat(resource?.amount?.value || '0.00');
    const donationDate   = resource?.update_time ? new Date(resource.update_time) : new Date();
    const txnId          = resource?.id || null;

    await this.recordDonation({
      email,
      rawFirst,
      rawLast,
      preferredFirst,
      preferredLast,
      donationAmount,
      donationDate,
      txnId,
    });
  }

  // -------------------- IPN --------------------
  private async handleIpn(payload: any) {
    const txnType = (payload?.txn_type || '').toLowerCase();
    const paymentStatus = (payload?.payment_status || '').toLowerCase();

    // Classic instant payment notification:
    if (txnType !== 'web_accept' || paymentStatus !== 'completed') {
      Logger.log(`ℹ️ Ignoring IPN txn_type=${txnType} payment_status=${paymentStatus}`, 'PaypalService');
      return;
    }

    const email = payload?.payer_email || payload?.receiver_email || payload?.custom;
    if (!email) {
      Logger.warn('⚠️ IPN missing email, skipping.', 'PaypalService');
      return;
    }

    const rawFirst = payload?.first_name || '';
    const rawLast  = payload?.last_name || '';
    const rawName  = `${rawFirst} ${rawLast}`.trim();
    const { first: preferredFirst, last: preferredLast } = normalizeName(rawName, email);

    const gross = payload?.mc_gross || payload?.payment_gross || payload?.amount || '0.00';
    const donationAmount = parseFloat(gross || '0.00');
    const donationDate   = payload?.payment_date ? new Date(payload.payment_date) : new Date();
    const txnId          = payload?.txn_id || null;

    await this.recordDonation({
      email,
      rawFirst,
      rawLast,
      preferredFirst,
      preferredLast,
      donationAmount,
      donationDate,
      txnId,
    });
  }

  // -------------------- Shared DB logic --------------------
  private async recordDonation(args: {
    email: string;
    rawFirst: string;
    rawLast: string;
    preferredFirst: string;
    preferredLast: string;
    donationAmount: number;
    donationDate: Date;
    txnId: string | null;
  }) {
    const {
      email,
      rawFirst,
      rawLast,
      preferredFirst,
      preferredLast,
      donationAmount,
      donationDate,
      txnId,
    } = args;

    Logger.log(`💵 Donation received: ${donationAmount.toFixed(2)} from ${email}`, 'PaypalService');

    // 1) Upsert donor and update lifetime + last_donation_amount + pending_update
    let lifetimeDonated = donationAmount;

    const existing = await this.db.query('SELECT lifetime_donated FROM donors WHERE email = $1', [email]);

    if (existing.rows.length > 0) {
      lifetimeDonated = parseFloat(existing.rows[0].lifetime_donated) + donationAmount;

      await this.db.query(
        `
        UPDATE donors
           SET legal_first_name       = $1,
               legal_last_name        = $2,
               preferred_first_name   = $3,
               preferred_last_name    = $4,
               lifetime_donated       = $5,
               last_donation_amount   = $6,
               pending_update         = TRUE,
               updated_at             = NOW()
         WHERE email                  = $7
        `,
        [rawFirst, rawLast, preferredFirst, preferredLast, lifetimeDonated, donationAmount, email],
      );
    } else {
      await this.db.query(
        `
        INSERT INTO donors
          (email, legal_first_name, legal_last_name, preferred_first_name, preferred_last_name,
           lifetime_donated, last_donation_amount, pending_update, updated_at)
        VALUES
          ($1,   $2,              $3,              $4,                    $5,
           $6,              $7,                 TRUE,          NOW())
        `,
        [email, rawFirst, rawLast, preferredFirst, preferredLast, lifetimeDonated, donationAmount],
      );
    }

    // 2) Insert donation (txn_id unique guard)
    await this.db.query(
      `
      INSERT INTO donations (donor_id, donation_date, amount, source, raw_email, txn_id)
      VALUES (
        (SELECT id FROM donors WHERE email = $1),
        $2, $3, 'paypal', $1, $4
      )
      ON CONFLICT (txn_id) DO NOTHING
      `,
      [email, donationDate, donationAmount, txnId],
    );

    // 3) Queue MailWizz sync
    await this.syncQueue.enqueue(email);

    // 4) Immediate MailWizz upsert + receipt toggle for *this* donation
    await this.mailwizzService.addOrUpdateSubscriber(
      preferredFirst || rawFirst,
      preferredLast || rawLast,
      email,
      donationAmount.toFixed(2),
      lifetimeDonated.toFixed(2),
      { triggerReceipt: donationAmount > 0 }
    );

    Logger.log(`✅ Donation recorded & MailWizz sync/enqueue complete for ${email}`, 'PaypalService');
  }
}
