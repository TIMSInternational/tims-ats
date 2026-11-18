// CloudWatch Synthetics uptime check (synthetics.tf). One script, three canaries: each canary passes
// its own TARGET_URL. A run succeeds only on a 2xx answer; anything else (3xx included — point the
// canary at the final URL, not one that redirects), a timeout or a TLS error fails the run, which
// drops the canary's SuccessPercent metric and trips its alarm.
//
// Request and response headers and bodies are deliberately NOT captured into the artifacts bucket:
// /ready reports dependency health, and nothing an uptime check needs is in a body.
//
// Namespaces: syn-nodejs-puppeteer-13.1 and later use the @aws/* module names. Keep this in step with
// local.synthetics_runtime_version in synthetics.tf.

const { URL } = require('url');
const synthetics = require('@aws/synthetics-puppeteer');
const log = require('@aws/synthetics-logger');

exports.handler = async () => {
  const raw = process.env.TARGET_URL;
  if (!raw) throw new Error('TARGET_URL is not set');
  const target = new URL(raw);
  if (target.protocol !== 'https:') throw new Error('TARGET_URL must be https');

  const requestOptions = {
    hostname: target.hostname,
    method: 'GET',
    path: `${target.pathname}${target.search}`,
    port: target.port ? Number(target.port) : 443,
    protocol: 'https:',
    headers: { 'User-Agent': synthetics.getCanaryUserAgentString() },
  };

  const validate = (res) =>
    new Promise((resolve, reject) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`unexpected HTTP status ${res.statusCode}`));
        }
      });
      res.on('error', reject);
    });

  const stepConfig = {
    includeRequestHeaders: false,
    includeResponseHeaders: false,
    includeRequestBody: false,
    includeResponseBody: false,
    continueOnHttpStepFailure: false,
  };

  log.info(`checking ${target.hostname}${target.pathname}`);
  await synthetics.executeHttpStep(process.env.STEP_NAME || 'uptime', requestOptions, validate, stepConfig);
};
