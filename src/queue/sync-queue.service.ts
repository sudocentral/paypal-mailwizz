import { Injectable, Inject } from '@nestjs/common';
import PQueue from 'p-queue';
import { Pool } from 'pg';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { pickDisplayNames } from '../utils/name-picker';

@Injectable()
export class SyncQueueService {
  private queue: PQueue;

  constructor(
    @Inject('PG_CONNECTION') private readonly db: Pool,
    private readonly mailwizzService: MailWizzService,
  ) {
    this.queue = new PQueue({ concurrency: 1 }); // process sequentially to avoid races
    console.log('📥 SyncQueue initialized');
  }

  async enqueue(email: string) {
    console.log(`📥 Queuing sync for ${email}`);
    this.queue.add(() => this.processJob(email));
  }

  private async processJob(email: string) {
    console.log(`⚙️ Processing sync for ${email}`);

    const { rows } = await this.db.query(
      `
      SELECT
        email,
        preferred_first_name,
        preferred_last_name,
        baptismal_name,
        legal_first_name,
        legal_last_name,
        lifetime_donated,
        last_donation_amount
      FROM donors
      WHERE email = $1
      `,
      [email],
    );

    if (rows.length === 0) {
      console.warn(`⚠️ No donor found for ${email}`);
      return;
    }

    const d = rows[0];
    const names = pickDisplayNames({
      preferred_first_name: d.preferred_first_name,
      preferred_last_name: d.preferred_last_name,
      baptismal_name: d.baptismal_name,
      legal_first_name: d.legal_first_name,
      legal_last_name: d.legal_last_name,
    });

    await this.mailwizzService.addOrUpdateSubscriber(
      names.first,
      names.last,
      d.email,
      (d.last_donation_amount ?? 0).toFixed(2),
      (d.lifetime_donated ?? 0).toFixed(2),
    );

    await this.db.query(
      `
      UPDATE donors
      SET pending_update = false, updated_at = NOW()
      WHERE email = $1
      `,
      [email],
    );

    console.log(`✅ Sync complete for ${email} (used: ${names.used})`);
  }
}

