import { Injectable } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class MailWizzService {
  private baseUrl: string;
  private apiKey: string;
  private listUid: string;

  constructor() {
    this.baseUrl = 'https://mvpes.sudomanaged.com/api/index.php';
    this.apiKey = process.env.MAILWIZZ_API_KEY as string;
    this.listUid = process.env.MAILWIZZ_LIST_UID || 'kc6447jr7p5eb'; // fallback to default
  }

  async addOrUpdateSubscriber(
    first_name: string,
    last_name: string,
    email: string,
    donation_amount: string,
    lifetime_donated: string
  ) {
    console.log('📤 DEBUG: Entering addOrUpdateSubscriber function...');
    console.log('📤 DEBUG: MailWizz Payload', {
      EMAIL: email,
      FNAME: first_name,
      LNAME: last_name,
      DONATION_AMOUNT: donation_amount,
      LIFETIME_DONATED: lifetime_donated,
    });

    const formData = new FormData();
    formData.append('EMAIL', email);
    formData.append('FNAME', first_name || '');
    formData.append('LNAME', last_name || '');
    formData.append('DONATION_AMOUNT', donation_amount || '');
    formData.append('LIFETIME_DONATED', lifetime_donated || '');
    formData.append('details[status]', 'confirmed');

    const createUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers`;

    try {
      // Try to create subscriber
      const response = await axios.post(createUrl, formData, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': this.apiKey,
          ...formData.getHeaders(),
        },
      });

      console.log('✅ DEBUG: Subscriber created successfully:', response.data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        console.warn(`⚠️ Subscriber exists, updating instead: ${email}`);

        // Step 1: Search subscriber by email
        const searchUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers/search-by-email?EMAIL=${encodeURIComponent(email)}`;
        const searchResponse = await axios.get<{ data?: { subscriber_uid?: string } }>(searchUrl, {
          headers: {
            Accept: 'application/json',
            'X-API-KEY': this.apiKey,
          },
        });

        const subscriberUid = searchResponse.data?.data?.subscriber_uid;
        if (!subscriberUid) {
          throw new Error(`Could not find subscriber UID for ${email}`);
        }

        // Step 2: Update subscriber by UID
        const updateUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers/${subscriberUid}`;
        const updateForm = new FormData();
        updateForm.append('EMAIL', email);  // ✅ make sure EMAIL is included
        updateForm.append('FNAME', first_name || '');
        updateForm.append('LNAME', last_name || '');
        updateForm.append('DONATION_AMOUNT', donation_amount || '');
        updateForm.append('LIFETIME_DONATED', lifetime_donated || '');
        updateForm.append('details[status]', 'confirmed');

        try {
          const updateResponse = await axios.put(updateUrl, updateForm, {
            headers: {
              Accept: 'application/json',
              'X-API-KEY': this.apiKey,
              ...updateForm.getHeaders(),
            },
          });

          console.log('♻️ DEBUG: Subscriber update request sent:', {
            url: updateUrl,
            payload: {
              EMAIL: email,
              FNAME: first_name,
              LNAME: last_name,
              DONATION_AMOUNT: donation_amount,
              LIFETIME_DONATED: lifetime_donated,
              status: 'confirmed',
            },
          });

          console.log('♻️ DEBUG: Subscriber update response:', updateResponse.data);

          return updateResponse.data;
        } catch (err: any) {
          console.error('❌ DEBUG: Update failed:', {
            url: updateUrl,
            error: err.response?.data || err.message,
          });
          throw err;
        }

        console.error('❌ DEBUG: MailWizz API Error:', error.response?.data || error.message);
        throw error;
      }
    }
  }
}