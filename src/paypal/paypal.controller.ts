import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { Request, Response } from 'express';
import * as qs from 'querystring';

@Controller('webhooks/paypal')
export class PaypalController {
  constructor(private readonly paypalService: PaypalService) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const contentType = req.headers['content-type'] || '';
      let event: any;

      if (contentType.includes('application/json')) {
        // ✅ REST Webhook
        console.log('📩 DEBUG: Received PayPal REST Webhook:', req.body);
        event = req.body;
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // ✅ IPN
        const raw = req.body instanceof Buffer ? req.body.toString() : req.body;
        const ipn = typeof raw === 'string' ? qs.parse(raw) : raw;
        console.log('📩 DEBUG: Received PayPal IPN:', ipn);

        // Normalize IPN → webhook-like structure
        event = {
          event_type: 'IPN.WEB_ACCEPT',
          resource: {
            id: ipn['txn_id'],
            amount: { value: ipn['mc_gross'] },
            payer: {
              email_address: ipn['payer_email'],
              name: {
                given_name: ipn['first_name'],
                surname: ipn['last_name'],
              },
            },
            raw: ipn, // keep full IPN in case you need it later
          },
        };
      } else {
        console.warn('⚠️ Unknown content type from PayPal:', contentType);
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send({ error: 'Unsupported content type' });
      }

      // Pass normalized event to service
      await this.paypalService.processWebhook(event);

      return res.status(HttpStatus.OK).send({ status: 'ok' });
    } catch (error) {
      console.error('❌ ERROR: PayPal Webhook processing failed:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send({ error: error.message });
    }
  }
}
