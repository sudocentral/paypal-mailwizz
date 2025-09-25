import { Injectable } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import * as dotenv from 'dotenv';
import qs from 'qs';

dotenv.config();

type Dict = Record<string, string | number | boolean | null | undefined>;

@Injectable()
export class MailWizzService {
  private baseUrl: string;
  private apiKey: string;
  private listUid: string;

  constructor() {
    this.baseUrl = process.env.MAILWIZZ_API_BASE || 'https://mvpes.sudomanaged.com/api/index.php';
    this.apiKey = process.env.MAILWIZZ_API_KEY as string;
    this.listUid = process.env.MAILWIZZ_LIST_UID as string;
  }

  private headers(form?: FormData) {
    return {
      Accept: 'application/json',
      // MailWizz accepts both, some installs are case-sensitive; keep the canonical one:
      'X-Api-Key': this.apiKey,
      ...(form ? form.getHeaders() : {}),
    };
  }

  private async searchByEmail(email: string) {
    const url = `${this.baseUrl}/lists/${this.listUid}/subscribers/search-by-email?EMAIL=${encodeURIComponent(email)}`;
    try {
      const r = await axios.get<{ status: string; data?: any }>(url, {
        headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey },
      });
      return r.data?.data || null;
    } catch (e: any) {
      // MailWizz returns 404/400 if not found
      return null;
    }
  }

  private async createSubscriber(payload: Dict) {
    const form = new FormData();
    for (const [k, v] of Object.entries(payload)) form.append(k, (v ?? '').toString());
    const url = `${this.baseUrl}/lists/${this.listUid}/subscribers`;
    const r = await axios.post(url, form, { headers: this.headers(form) });
    return r.data;
  }

  private async updateSubscriber(subscriberUid: string, payload: Dict) {
    const url = `${this.baseUrl}/lists/${this.listUid}/subscribers/${subscriberUid}`;
    // MailWizz update prefers x-www-form-urlencoded for PUT
    const r = await axios.put(url, qs.stringify(payload), {
      headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return r.data;
  }

  /**
   * Upsert the subscriber and set fields. If a positive donationAmount is supplied,
   * we also toggle SEND_RECEIPT (1 then 0 after ~60s).
   */
  async addOrUpdateSubscriber(
    first_name: string,
    last_name: string,
    email: string,
    donationAmount: string,     // "25.00"
    lifetimeDonated: string,    // "1234.00"
    opts?: { triggerReceipt?: boolean }
  ) {
    const baseFields: Dict = {
      EMAIL: email,
      FNAME: first_name || '',
      LNAME: last_name || '',
      DONATION_AMOUNT: donationAmount || '',
      LIFETIME_DONATED: lifetimeDonated || '',
      'details[status]': 'confirmed',
    };

    const existing = await this.searchByEmail(email);
    if (!existing?.subscriber_uid) {
      await this.createSubscriber(baseFields);
    } else {
      // For updates, do not include EMAIL again in the PUT body; MailWizz identifies by subscriber UID.
      const { EMAIL, ...updateFields } = baseFields;
      await this.updateSubscriber(existing.subscriber_uid, updateFields);
    }

    // Only toggle receipts if caller asked us to (i.e., for *new* donations)
    const shouldTrigger =
      opts?.triggerReceipt === true &&
      !!donationAmount &&
      !isNaN(Number(donationAmount)) &&
      Number(donationAmount) > 0;

    if (shouldTrigger) {
      this.triggerReceipt(email).catch((e) =>
        console.error('❌ SEND_RECEIPT toggle failed:', e?.message || e),
      );
    }
  }

  /**
   * Flip SEND_RECEIPT to 1, then reset it back to 0 after ~60 seconds.
   * Uses the same create/update endpoint with EMAIL to target the subscriber.
   */
  async triggerReceipt(email: string) {
    const setFlag = async (value: '0' | '1') => {
      const form = new FormData();
      form.append('EMAIL', email);
      form.append('SEND_RECEIPT', value);
      const url = `${this.baseUrl}/lists/${this.listUid}/subscribers`;
      await axios.post(url, form, { headers: this.headers(form) });
    };

    await setFlag('1');
    setTimeout(() => {
      setFlag('0').catch((e) => console.error(`❌ SEND_RECEIPT reset failed for ${email}:`, e?.message || e));
    }, 60_000);
  }
}
