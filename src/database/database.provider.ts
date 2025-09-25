import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config(); // ✅ ensures .env is loaded before using process.env

export const DatabaseProvider = [
  {
    provide: 'PG_CONNECTION',
    useFactory: async () => {
      const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASS,
        port: parseInt(process.env.DB_PORT || '5432', 10),
      });
      return pool;
    },
  },
];
