import axios = require('axios');
import * as dotenv from 'dotenv';

dotenv.config(); // Load environment variables

async function addSubscriberToMailWizz(first_name: string, last_name: string, email: string) {
  console.log('📤 DEBUG: Entering addSubscriberToMailWizz function...');

  const LIST_UID = 'bh0947g58852a';
  const SEGMENT_UID = 'nh1084tx1ld53';
  const MAILWIZZ_API_URL = `https://oss.sudomanaged.com/api/lists/${LIST_UID}/subscribers`;
  const headers = {
    'Content-Type': 'application/json',
    'X-MW-API-KEY': process.env.MAILWIZZ_API_KEY || 'YOUR_TEST_API_KEY',
  };

  // ✅ Corrected payload structure
  const data = {
    EMAIL: email, 
    FNAME: first_name || '',
    LNAME: last_name || ''
  };

  console.log('📤 DEBUG: Sending request to MailWizz:', JSON.stringify(data));

  try {
    const response = await axios.post(MAILWIZZ_API_URL, data, { headers });
    console.log(`✅ DEBUG: MailWizz Response:`, response.data);
  } catch (error) {
    console.error('❌ DEBUG: MailWizz API Error:', error.response?.data || error.message);
  }
}

// Run a test request
addSubscriberToMailWizz('Bob', 'Biller', 'bob@biller.com');

