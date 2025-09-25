import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { MailWizzService } from '../mailwizz/mailwizz.service';

/**
 * ⚠️ NOTE:
 * This Shopify controller is currently DISABLED.
 * Webhooks hitting this endpoint will return a "disabled" message
 * and will NOT send data to MailWizz.
 *
 * To ENABLE Shopify in the future:
 *  1. Remove the safeguard return below.
 *  2. Wire ShopifyController into AppModule.
 *  3. Test with a live Shopify webhook.
 */
@Controller('shopify/webhook')
export class ShopifyController {
  constructor(private readonly mailWizzService: MailWizzService) {}

  @Post('customer')
  async handleNewCustomer(@Req() req: Request, @Res() res: Response) {
    // 🚫 Safeguard: Immediately stop processing
    console.log('⚠️ Shopify webhook received but module is disabled.');
    return res.status(200).send({ status: 'shopify-disabled' });

    // 🟢 REMOVE THIS SAFEGUARD TO GO LIVE:
    /*
    console.log('🔍 Webhook received:', req.body);

    const first_name = req.body.first_name || req.body.default_address?.first_name || '';
    const last_name = req.body.last_name || req.body.default_address?.last_name || '';
    const email = req.body.email || req.body.contact_email || '';

    if (!email) {
      console.error('❌ No email provided in webhook payload.');
      return res.status(400).send({ error: 'Email is required' });
    }

    // ✅ Early response — before doing anything async
    res.status(200).send({ message: 'Webhook received, processing in background.' });

    // 🚀 Now do ALL background work fully detached
    setImmediate(() => {
      (async () => {
        try {
          console.log(`📡 Adding subscriber to MailWizz: ${email}`);
          await this.mailWizzService.addSubscriber(first_name, last_name, email);
          console.log(`✅ MailWizz success for: ${email}`);
        } catch (err) {
          console.error('🔥 MailWizz background error:', err);
        }
      })();
    });
    */
  }
}

