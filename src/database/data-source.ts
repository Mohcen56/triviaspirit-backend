import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database-options';

export default new DataSource(databaseOptions());
