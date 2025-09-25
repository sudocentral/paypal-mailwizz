import { Injectable } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import * as dotenv from 'dotenv';

dotenv.config(); // Load environment variables

@Injectable()
export class MailWizzService {
  private baseUrl: string;
  private apiKey: string;
  private listUid: string;

  constructor() {
    this.baseUrl = process.env.MAILWIZZ_API_BASE || 'https://mvpes.sudomanaged.com/api/index.php';
    this.apiKey = process.env.MAILWIZZ_API_KEY as string;
    this.listUid = process.env.MAILWIZZ_LIST_UID as string;
    console.log('🔑 DEBUG: Using API Key:', this.apiKey);
  }

  /**
   * Create or update a subscriber and set donation custom fields.
   * Fields expected in MailWizz:
   *  - EMAIL
   *  - FNAME
   *  - LNAME
   *  - DONATION_AMOUNT
   *  - LIFETIME_DONATED
   */
  async addSubscriber(
    first_name: string,
    last_name: string,
    email: string,
    donation_amount: string,
    lifetime_donated: string,
  ) {
    const formData = new FormData();
    formData.append('EMAIL', email);
    formData.append('FNAME', first_name || '');
    formData.append('LNAME', last_name || '');
    formData.append('DONATION_AMOUNT', donation_amount || '');
    formData.append('LIFETIME_DONATED', lifetime_donated || '');
    formData.append('details[status]', 'confirmed'); // ensure active/confirmed

    const url = `${this.baseUrl}/lists/${this.listUid}/subscribers`;

    try {
      const response = await axios.post(url, formData, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': this.apiKey,
          ...formData.getHeaders(),
        },
      });
      console.log('✅ DEBUG: Subscriber created/updated:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ DEBUG: MailWizz API Error (addSubscriber):', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Flip SEND_RECEIPT to 1, then reset it back to 0 after ~60 seconds.
   * MailWizz automation should send a receipt when SEND_RECEIPT == 1.
   */
  async triggerReceipt(email: string) {
    const setFlag = async (value: '0' | '1') => {
      const formData = new FormData();
      formData.append('EMAIL', email);
      formData.append('SEND_RECEIPT', value);
      // No need to change status here
      const url = `${this.baseUrl}/lists/${this.listUid}/subscribers`;

      try {
        const resp = await axios.post(url, formData, {
          headers: {
            Accept: 'application/json',
            'X-API-KEY': this.apiKey,
            ...formData.getHeaders(),
          },
        });
        console.log(`🔁 DEBUG: SEND_RECEIPT=${value} for ${email}:`, resp.data);
      } catch (error: any) {
        console.error(`❌ DEBUG: Failed to set SEND_RECEIPT=${value} for ${email}:`, error.response?.data || error.message);
      }
    };

    // Set to 1 now
    await setFlag('1');

    // Reset to 0 after 60s (detached; do not block webhook response)
    setTimeout(() => {
      setFlag('0').catch((e) =>
        console.error(`❌ DEBUG: SEND_RECEIPT reset failed for ${email}:`, e?.message || e),
      );
    }, 60_000);
  }
}
