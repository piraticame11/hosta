#!/usr/bin/env node
/**
 * scripts/test-hestia.js
 * Standalone verification script for testing HestiaCP API connectivity,
 * credential configuration, and parameter sanitization without launching
 * the full Express web server.
 */

require('dotenv').config();
const hestiaService = require('../server/services/hestiaService');

async function runTests() {
  console.log('======================================================');
  console.log('   🚀 Hosta -> HestiaCP API Diagnostic & Test Suite');
  console.log('======================================================\n');

  // -----------------------------------------------------------------
  // 1. ENVIRONMENT CONFIGURATION CHECK
  // -----------------------------------------------------------------
  console.log('📋 [1/3] Checking Environment Configuration...');

  const apiUrl = process.env.HESTIA_API_URL || (process.env.HESTIA_HOST ? `${process.env.HESTIA_HOST.replace(/\/+$/, '')}/api/` : 'https://127.0.0.1:8083/api/');
  const accessKey = process.env.HESTIA_ACCESS_KEY || process.env.HESTIA_ACCESS_KEY_ID || '';
  const secretKey = process.env.HESTIA_SECRET_KEY || process.env.HESTIA_SECRET_ACCESS_KEY || '';
  const defaultUser = process.env.HESTIA_DEFAULT_USER || 'hostb';
  const defaultPackage = process.env.HESTIA_DEFAULT_PACKAGE || 'default';

  const maskedAccess = accessKey ? `${accessKey.substring(0, 4)}...${accessKey.slice(-3)}` : '(Not configured)';
  const maskedSecret = secretKey ? `${secretKey.substring(0, 3)}...${secretKey.slice(-3)}` : '(Not configured)';

  console.log(`   - HESTIA_API_URL:         ${apiUrl}`);
  console.log(`   - HESTIA_DEFAULT_USER:    ${defaultUser}`);
  console.log(`   - HESTIA_DEFAULT_PACKAGE: ${defaultPackage}`);
  console.log(`   - HESTIA_ACCESS_KEY:      ${maskedAccess}`);
  console.log(`   - HESTIA_SECRET_KEY:      ${maskedSecret}`);

  const hasCredentials = Boolean(accessKey && secretKey && accessKey !== 'your_access_key_here' && secretKey !== 'your_secret_key_here');

  if (!hasCredentials) {
    console.log('   ⚠️  NOTICE: HESTIA_ACCESS_KEY or HESTIA_SECRET_KEY is empty or set to placeholder.');
    console.log('      To test against a live HestiaCP instance, configure real API keys in .env.');
  } else {
    console.log('   ✅ Valid API key format detected.');
  }
  console.log('');

  // -----------------------------------------------------------------
  // 2. PARAMETER SANITIZATION TEST
  // -----------------------------------------------------------------
  console.log('🛡️  [2/3] Verifying Parameter Sanitization Logic...');

  let sanitizationPassed = true;

  try {
    // Domain sanitization tests
    const testDomain = 'https://My-Subdomain.Hosta.Site/dashboard?ref=123:8080';
    const sanitizedDomain = hestiaService.sanitizeDomain(testDomain);
    if (sanitizedDomain !== 'my-subdomain.hosta.site') {
      throw new Error(`Domain sanitization mismatch: expected 'my-subdomain.hosta.site', got '${sanitizedDomain}'`);
    }

    // Invalid domain test (should throw)
    let caughtDomainErr = false;
    try {
      hestiaService.sanitizeDomain('invalid_domain_no_dot');
    } catch {
      caughtDomainErr = true;
    }
    if (!caughtDomainErr) {
      throw new Error('Invalid domain was unexpectedly accepted without error.');
    }

    // Username sanitization test
    const testUser = '  HostB_User-01!  ';
    const sanitizedUser = hestiaService.sanitizeUsername(testUser);
    if (sanitizedUser !== 'hostb_user-01') {
      throw new Error(`Username sanitization mismatch: expected 'hostb_user-01', got '${sanitizedUser}'`);
    }

    // Database name sanitization test
    const testDb = '  My_WordPress-DB#1! ';
    const sanitizedDb = hestiaService.sanitizeDatabaseName(testDb);
    if (sanitizedDb !== 'my_wordpressdb1') {
      throw new Error(`Database name sanitization mismatch: expected 'my_wordpressdb1', got '${sanitizedDb}'`);
    }

    // Email prefix sanitization test
    const testEmail = 'Admin.Support@Hosta.Site';
    const sanitizedEmail = hestiaService.sanitizeEmailUser(testEmail);
    if (sanitizedEmail !== 'admin.support') {
      throw new Error(`Email user sanitization mismatch: expected 'admin.support', got '${sanitizedEmail}'`);
    }

    console.log('   ✅ All parameter sanitizers passed:');
    console.log(`      • Domain:   "${testDomain}" -> "${sanitizedDomain}"`);
    console.log(`      • User:     "${testUser}" -> "${sanitizedUser}"`);
    console.log(`      • Database: "${testDb}" -> "${sanitizedDb}"`);
    console.log(`      • Mailbox:  "${testEmail}" -> "${sanitizedEmail}"`);
  } catch (sanErr) {
    sanitizationPassed = false;
    console.error(`   ❌ Sanitization Test Failed: ${sanErr.message}`);
  }
  console.log('');

  // -----------------------------------------------------------------
  // 3. LIVE HESTIACP API CONNECTIVITY TEST
  // -----------------------------------------------------------------
  console.log('🔌 [3/3] Testing HestiaCP API Connectivity...');

  if (!hasCredentials) {
    console.log('   ⏭️  Skipping remote API call because live credentials are not set in .env.');
    console.log('      To test remote execution:');
    console.log('      1. Open your HestiaCP Panel (e.g., https://your-server:8083)');
    console.log('      2. Go to Server Settings > API > Create Access Key');
    console.log('      3. Add HESTIA_ACCESS_KEY and HESTIA_SECRET_KEY to your .env file');
    console.log('      4. Re-run: node scripts/test-hestia.js\n');
  } else {
    try {
      console.log(`   Connecting to HestiaCP at: ${apiUrl}`);
      console.log(`   Querying usage metrics for user '${defaultUser}' (v-list-user)...`);

      const usageResult = await hestiaService.getUserUsage(defaultUser);

      console.log('   ✅ SUCCESS: Received response from HestiaCP API!');
      console.log('\n--- Usage Metrics Received ---');
      console.dir(usageResult, { depth: null, colors: true });
      console.log('-------------------------------\n');
    } catch (apiErr) {
      console.error(`   ❌ API Connection Request Failed: ${apiErr.message}`);
      if (apiErr.code) {
        console.error(`   Error Code: ${apiErr.code} (${hestiaService.mapHestiaError(apiErr.code)})`);
      }
      console.log('\n   💡 Troubleshooting & Solution:');
      if (apiErr.message.includes('IP is not allowed') || apiErr.message.includes('401')) {
        console.log('   👉 HestiaCP rejected the connection because your current IP address is not whitelisted for this Access Key.');
        console.log('      To resolve:');
        console.log('      1. Log in to HestiaCP: https://panel.hosta.site');
        console.log('      2. Go to Server Settings (gear icon) > API');
        console.log('      3. Edit your Access Key (YjEa0WyNXRquZuhSbM3i)');
        console.log('      4. In "Allowed IP Addresses", append your current public IP or subnet:');
        console.log('         - Your public IP: 180.191.79.17 (or enter 0.0.0.0/0 to allow all IPs during development)');
        console.log('         - On the production server (/home/hostb/web/hosta.site/public_html), localhost (127.0.0.1) will be used.');
      } else {
        console.log('   - Verify that HestiaCP is running and accessible');
        console.log('   - Verify HESTIA_API_URL includes https:// (e.g. https://panel.hosta.site/api/)');
        console.log('   - Verify the system user exists in HestiaCP');
      }
      console.log('');
    }
  }

  console.log('======================================================');
  if (sanitizationPassed) {
    console.log('   🎉 Service module & validation verification complete.');
  } else {
    console.log('   ⚠️  Some tests encountered warnings or failures.');
  }
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('[Fatal Test Error]', err);
  process.exit(1);
});
