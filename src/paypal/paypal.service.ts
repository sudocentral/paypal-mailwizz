import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { normalizeName } from '../utils/normalize';

@Injectable()
export class PaypalService {
  constructor(
    @Inject('PG_CONNECTION') private readonly db: Pool,
    private readonly mailwizzService: MailWizzService,
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
    const { first: preferredFirst, last: preferredLast } = normalizeName(rawName, email);

    const donationAmount = parseFloat(resource?.amount?.value || '0.00');
    const donationDate = resource?.update_time ? new Date(resource.update_time) : new Date();

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
        SET legal_first_name=$1,
            legal_last_name=$2,
            preferred_first_name=$3,
            preferred_last_name=$4,
            lifetime_donated=$5,
            updated_at=NOW()
        WHERE email=$6
        `,
        [rawFirst, rawLast, preferredFirst, preferredLast, lifetimeDonated, email],
      );
    } else {
      await this.db.query(
        `
        INSERT INTO donors
          (email, legal_first_name, legal_last_name, preferred_first_name, preferred_last_name, lifetime_donated, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [email, rawFirst, rawLast, preferredFirst, preferredLast, lifetimeDonated],
      );
    }

    // Step 2: Insert donation record (with txn_id protection)
    const txnId = resource?.id || null;
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

    console.log(`📊 Updated donor lifetime total: ${lifetimeDonated}`);

    // Step 3: Update MailWizz subscriber
    await this.mailwizzService.addSubscriber(
      preferredFirst || rawFirst,
      preferredLast || rawLast,
      email,
      donationAmount.toFixed(2),
      lifetimeDonated.toFixed(2),
    );
    // Step 4: Fire receipt toggle (1 → 0 after ~60s)
    await this.mailwizzService.triggerReceipt(email);
  }
}
