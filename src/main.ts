import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as bodyParser from 'body-parser';

dotenv.config(); // Load environment variables

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Add body-parser to support both JSON (PayPal REST) and x-www-form-urlencoded (PayPal IPN)
  app.use(bodyParser.json({ limit: '5mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

  // Middleware to log and attach subdomain
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (host) {
      const subdomain = host.split('.')[0]; // Extract subdomain (e.g., "oss-shopify")
      Logger.log(`Incoming request from: ${subdomain}`, 'SubdomainMiddleware');
      req['subdomain'] = subdomain; // Attach subdomain to request object
    }
    next();
  });

  // ✅ Default to '3001' as a string, then parse to number
  const port = parseInt(process.env.PORT || '3001', 10);

  await app.listen(port, '0.0.0.0');
  Logger.log(`API Server is running on port ${port}`, 'Bootstrap');
}

bootstrap();
