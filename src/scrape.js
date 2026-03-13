#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { GSTModule } from './core/gstModule.js';
import { logger } from './utils/logger.js';

/**
 * CLI tool for GST Record Fetcher with Real Portal Scraping
 */
async function main() {
  console.log(chalk.cyan.bold('\n╔═══════════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║     GST RECORD FETCHER - REAL PORTAL SCRAPING (Manual Captcha Mode)          ║'));
  console.log(chalk.cyan.bold('║                    Browser will open for captcha solving                      ║'));
  console.log(chalk.cyan.bold('╚═══════════════════════════════════════════════════════════════════════════════╝\n'));

  // Get GSTIN from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('❌ Error: Please provide a GSTIN number\n'));
    console.log(chalk.yellow('Usage:'));
    console.log(chalk.white('  npm start <GSTIN>'));
    console.log(chalk.white('  node src/scrape.js <GSTIN>\n'));
    console.log(chalk.yellow('Examples:'));
    console.log(chalk.white('  npm start 26AAVCA3240Q1Z2'));
    console.log(chalk.white('  node src/scrape.js 29AAGCB7383E1Z1\n'));
    console.log(chalk.yellow('How it works:'));
    console.log(chalk.white('  1. Browser window will open'));
    console.log(chalk.white('  2. GSTIN will be auto-filled'));
    console.log(chalk.white('  3. Solve the captcha manually'));
    console.log(chalk.white('  4. Click search button'));
    console.log(chalk.white('  5. Data will be extracted automatically\n'));
    process.exit(1);
  }

  const gstin = args[0];
  console.log(chalk.blue(`🔍 Processing GSTIN: ${chalk.bold(gstin)}\n`));
  console.log(chalk.yellow('📋 Instructions:'));
  console.log(chalk.white('  • A browser window will open shortly'));
  console.log(chalk.white('  • GSTIN is already filled'));
  console.log(chalk.white('  • Solve the captcha'));
  console.log(chalk.white('  • Click "Search" button'));
  console.log(chalk.white('  • Wait for data extraction\n'));

  // Initialize GST Module
  const gstModule = new GSTModule();

  const spinner = ora({
    text: 'Opening browser and navigating to GST Portal...',
    color: 'cyan'
  }).start();

  // Fetch and display GST record
  const result = await gstModule.getGSTRecord(gstin, { format: 'console' });

  spinner.stop();

  if (result.success) {
    console.log(result.formatted);
    console.log(chalk.green('\n✅ Real GST record fetched successfully from portal!'));
    console.log(chalk.gray(`⏱️  Execution time: ${result.metadata.executionTime}`));
    console.log(chalk.gray(`📅 Fetched at: ${new Date(result.metadata.fetchedAt).toLocaleString('en-IN')}\n`));
  } else {
    console.log(chalk.red('\n❌ Error: ' + result.error));
    console.log(chalk.red(`Error Code: ${result.errorCode}\n`));
    
    if (result.details && process.env.NODE_ENV === 'development') {
      console.log(chalk.gray('Details:'));
      console.log(chalk.gray(result.details));
    }
    
    console.log(chalk.yellow('\n💡 Troubleshooting Tips:'));
    console.log(chalk.white('  1. Make sure you solved the captcha correctly'));
    console.log(chalk.white('  2. Click the search button after entering captcha'));
    console.log(chalk.white('  3. Check your internet connection'));
    console.log(chalk.white('  4. The GST portal may be under maintenance'));
    console.log(chalk.white('  5. Try again with a different GSTIN\n'));
    
    process.exit(1);
  }
}

// Run the application with error handling
main().catch(error => {
  console.error(chalk.red('\n❌ Fatal error: ' + error.message));
  logger.error('Fatal error in main', { error: error.message, stack: error.stack });
  process.exit(1);
});
