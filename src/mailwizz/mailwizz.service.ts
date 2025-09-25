import { Injectable } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import * as dotenv from 'dotenv';
import qs from 'qs';

dotenv.config();

interface MailWizzSearchResponse {
  status: string;
  data?: {
    subscriber_uid?: string;
    EMAIL?: string;
    FNAME?: string;
    LNAME?: string;
    [key: string]: any;
  };
}

@Injectable()
export class MailWizzService {
  private baseUrl: string;
  private apiKey: string;
  private listUid: string;

  constructor() {
    this.baseUrl =
      process.env.MAILWIZZ_API_BASE || 'https://mvpes.sudomanaged.com/api';
    this.apiKey = process.env.MAILWIZZ_API_KEY as string;
    this.listUid = process.env.MAILWIZZ_LIST_UID as string;
  }

  async addOrUpdateSubscriber(
    first_name: string,
    last_name: string,
    email: string,
    donation_amount: string,
    lifetime_donated: string,
  ) {
    // --- Step 1: Search by email ---
    const searchUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers/search-by-email?EMAIL=${encodeURIComponent(
      email,
    )}`;
    console.log('🔍 Searching subscriber by email:', searchUrl);

    const searchResponse = await axios.get<MailWizzSearchResponse>(searchUrl, {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': this.apiKey,
      },
    });

    const subscriberUid = searchResponse.data?.data?.subscriber_uid;
    const existingFname = searchResponse.data?.data?.FNAME || '';
    const existingLname = searchResponse.data?.data?.LNAME || '';

    if (!subscriberUid) {
      // --- If not found, create ---
      console.log(`➕ Subscriber not found, creating new: ${email}`);
      const formData = new FormData();
      formData.append('EMAIL', email);
      formData.append('FNAME', first_name || '');
      formData.append('LNAME', last_name || '');
      formData.append('DONATION_AMOUNT', donation_amount || '');
      formData.append('LIFETIME_DONATED', lifetime_donated || '');
      formData.append('details[status]', 'confirmed');

      const createUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers`;

      const createResponse = await axios.post(createUrl, formData, {
        headers: {
          Accept: 'application/json',
          'X-Api-Key': this.apiKey,
          ...formData.getHeaders(),
        },
      });

      console.log('✅ Subscriber created:', createResponse.data);
      return createResponse.data;
    }

    // --- Step 2: Update existing subscriber ---
    console.log(`♻️ Updating subscriber ${email} (UID: ${subscriberUid})`);
    const updateUrl = `${this.baseUrl}/lists/${this.listUid}/subscribers/${subscriberUid}`;

    const payload: any = {
      EMAIL: email,
      FNAME: first_name || existingFname,
      LNAME: last_name || existingLname,
      DONATION_AMOUNT: donation_amount || '',
      LIFETIME_DONATED: lifetime_donated || '',
      'details[status]': 'confirmed',
      SEND_RECEIPT: '1', // 🚀 trigger AR
    };

    console.log('♻️ DEBUG: About to PUT to MailWizz');
    console.log('♻️ DEBUG: URL:', updateUrl);
    console.log('♻️ DEBUG: Fields:', payload);

    const updateResponse = await axios.put(updateUrl, qs.stringify(payload), {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    console.log('✅ Subscriber updated:', updateResponse.data);

    // --- Step 3: Reset SEND_RECEIPT back to 0 after 60s ---
    setTimeout(async () => {
      try {
        console.log(`⏳ Resetting SEND_RECEIPT=0 for ${email}`);
        const resetPayload = {
          EMAIL: email,
          SEND_RECEIPT: '0',
        };

        const resetResponse = await axios.put(
          updateUrl,
          qs.stringify(resetPayload),
          {
            headers: {
              Accept: 'application/json',
              'X-Api-Key': this.apiKey,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        );

        console.log('✅ SEND_RECEIPT reset complete:', resetResponse.data);
      } catch (err: any) {
        console.error(
          `❌ Failed to reset SEND_RECEIPT for ${email}`,
          err.message,
        );
      }
    }, 60000); // 60 seconds

    return updateResponse.data;
  }
}
