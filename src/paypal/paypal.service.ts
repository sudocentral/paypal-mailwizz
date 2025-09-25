import { Injectable, Inject } from '@nestjs/common';
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
   * Main entry point for PayPal webhook
   */
  async processWebhook(payload: any) {
    const eventType = payload.event_type;

    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      console.log(`ℹ️ Ignoring event type: ${eventType}`);
      return;
    }

    const resource = payload.resource;
    const email = resource?.payer?.email_address;

    // Raw PayPal names (legal)
    const rawFirst = resource?.payer?.name?.given_name || '';
    const rawLast = resource?.payer?.name?.surname || '';
    const rawName = `${rawFirst} ${rawLast}`.trim();

    // Normalized preferred names
    const { first: preferredFirst, last: preferredLast } = normalizeName(
      rawName,
      email,
    );

    const donationAmount = parseFloat(resource?.amount?.value || '0.00');
    const donationDate = resource?.update_time
      ? new Date(resource.update_time)
      : new Date();

    if (!email) {
      console.warn('⚠️ Webhook missing email, skipping.');
      return;
    }

    console.log(`💵 Donation received: ${donationAmount} from ${email}`);

    // Step 1: Upsert donor in Postgres
    let lifetimeDonated = donationAmount;

    const existing = await this.db.query(
      'SELECT lifetime_donated FROM donors WHERE email = $1',
      [email],
    );

    if (existing.rows.length > 0) {
      lifetimeDonated =
        parseFloat(existing.rows[0].lifetime_donated) + donationAmount;

      await this.db.query(
        `
        UPDATE donors
        SET legal_first_name = $1,
            legal_last_name = $2,
            preferred_first_name = $3,
            preferred_last_name = $4,
            lifetime_donated = $5,
            last_donation_amount = $6,
            pending_update = TRUE,
            updated_at = NOW()
        WHERE email = $7
        `,
        [
          rawFirst,
          rawLast,
          preferredFirst,
          preferredLast,
          lifetimeDonated,
          donationAmount,
          email,
        ],
      );
    } else {
      await this.db.query(
        `
        INSERT INTO donors
          (email, legal_first_name, legal_last_name, preferred_first_name, preferred_last_name, lifetime_donated, last_donation_amount, pending_update, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
        `,
        [
          email,
          rawFirst,
          rawLast,
          preferredFirst,
          preferredLast,
          lifetimeDonated,
          donationAmount,
        ],
      );
    }

    console.log(`🕓 Marked ${email} for MailWizz sync.`);

    // Step 2: Insert donation record
    const txnId =
      resource?.id ||
      resource?.supplementary_data?.related_ids?.capture_id ||
      null;

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

    // Step 3: Enqueue for async MailWizz sync
    await this.syncQueue.enqueue(email);
    console.log(`📥 Queued ${email} for MailWizz sync.`);
  }
}
