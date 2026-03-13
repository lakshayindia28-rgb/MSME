#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { GSTModule } from './core/gstModule.js';
import { logger } from './utils/logger.js';

/**
 * Production-grade GST Record Fetcher - International Standard
 */
async function main() {
  console.log(chalk.cyan.bold('\n╔═══════════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║         GST RECORD FETCHER - GOVERNMENT PORTAL DATA (Production v1.0)        ║'));
  console.log(chalk.cyan.bold('║                    International Grade - Real-time Data                      ║'));
  console.log(chalk.cyan.bold('╚═══════════════════════════════════════════════════════════════════════════════╝\n'));

  // Get GSTIN from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('❌ Error: Please provide a GSTIN number\n'));
    console.log(chalk.yellow('Usage:'));
    console.log(chalk.white('  npm start <GSTIN>'));
    console.log(chalk.white('  node src/index.js <GSTIN>\n'));
    console.log(chalk.yellow('Examples:'));
    console.log(chalk.white('  npm start 27AAPFU0939F1ZV'));
    console.log(chalk.white('  npm start 29AAGCB7383E1Z1\n'));
    console.log(chalk.yellow('Batch processing:'));
    console.log(chalk.white('  npm start 27AAPFU0939F1ZV 29AAGCB7383E1Z1 07AACCS6127N1ZC\n'));
    process.exit(1);
  }

  // Initialize GST Module
  const gstModule = new GSTModule();

  // Check if batch processing
  if (args.length > 1) {
    console.log(chalk.blue(`📦 Batch Processing Mode: ${args.length} GSTINs\n`));
    
    const spinner = ora('Processing batch...').start();
    const batchResult = await gstModule.getMultipleGSTRecords(args, { format: 'console' });
    spinner.stop();

    console.log(chalk.green('\n✅ Batch Processing Complete!\n'));
    console.log(chalk.yellow('Summary:'));
    console.log(chalk.white(`  Total: ${batchResult.summary.total}`));
    console.log(chalk.green(`  Success: ${batchResult.summary.success}`));
    console.log(chalk.red(`  Failed: ${batchResult.summary.failed}`));
    console.log(chalk.cyan(`  Success Rate: ${batchResult.summary.successRate}\n`));

    // Display each result
    batchResult.results.forEach((result, idx) => {
      console.log(chalk.yellow(`\n${'═'.repeat(85)}`));
      console.log(chalk.yellow(`Result ${idx + 1}/${batchResult.results.length}: ${result.gstin}`));
      console.log(chalk.yellow('═'.repeat(85)));
      
      if (result.success) {
        console.log(result.formatted);
      } else {
        console.log(chalk.red(`\n❌ Error: ${result.error}\n`));
      }
    });

  } else {
    // Single GSTIN processing
    const gstin = args[0];
    console.log(chalk.blue(`🔍 Processing GSTIN: ${chalk.bold(gstin)}\n`));

    const spinner = ora({
      text: 'Validating GSTIN...',
      color: 'cyan'
    }).start();

    // Fetch and display GST record
    const result = await gstModule.getGSTRecord(gstin, { format: 'console' });

    spinner.stop();

    if (result.success) {
      console.log(result.formatted);
      console.log(chalk.green('\n✅ GST record fetched successfully!'));
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
      console.log(chalk.white('  1. Verify the GSTIN is correct (15 characters)'));
      console.log(chalk.white('  2. Check your internet connection'));
      console.log(chalk.white('  3. The GST portal may be under maintenance'));
      console.log(chalk.white('  4. Try again after a few minutes\n'));
      
      process.exit(1);
    }
  }

  // Show queue status if any pending
  const queueStatus = gstModule.getQueueStatus();
  if (queueStatus.pending > 0) {
    console.log(chalk.yellow(`\n⏳ Queue status: ${queueStatus.pending} requests pending\n`));
  }
}

// Run the application with error handling
main().catch(error => {
  console.error(chalk.red('\n❌ Fatal error: ' + error.message));
  logger.error('Fatal error in main', { error: error.message, stack: error.stack });
  process.exit(1);
});
