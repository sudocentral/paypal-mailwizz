import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { pickDisplayNames } from '../utils/name-picker';

@Injectable()
export class SyncService {
  constructor(
    @Inject('PG_CONNECTION') private readonly db: Pool,
    private readonly mailwizzService: MailWizzService,
  ) {}

  /**
   * Sync all donors from Postgres into MailWizz
   */
  async syncAllDonors() {
    Logger.log('🚀 Starting donor sync...', 'SyncService');

    const donors = await this.db.query(`
      SELECT email, legal_first_name, legal_last_name, lifetime_donated
      FROM donors
      WHERE email IS NOT NULL
    `);

    for (const donor of donors.rows) {
      try {
        Logger.log(`🔄 Syncing donor: ${donor.email}`, 'SyncService');

    const names = pickDisplayNames(donor);
        await this.mailwizzService.addOrUpdateSubscriber(
          names.first,
          names.last,
          donor.email,
          '0.00', // optional: last donation amount (not tracked here)
          donor.lifetime_donated?.toString() || '0.00',
        );
      } catch (err) {
        Logger.error(
          `❌ Failed to sync donor ${donor.email}: ${err.message}`,
          '',
          'SyncService',
        );
      }
    }

    Logger.log('✅ Donor sync completed.', 'SyncService');
  }
}

