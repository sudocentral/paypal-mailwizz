import { Module } from '@nestjs/common';
import { DatabaseProvider } from './database.provider';

@Module({
  providers: [...DatabaseProvider], // spread the array
  exports: [...DatabaseProvider],   // spread again here
})
export class DatabaseModule {}