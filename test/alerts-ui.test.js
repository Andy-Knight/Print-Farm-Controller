import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const alertsUi = fs.readFileSync(new URL('../public/alerts.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const alertService = fs.readFileSync(new URL('../src/alert-service.js', import.meta.url), 'utf8');
const providers = fs.readFileSync(new URL('../src/notification-providers.js', import.meta.url), 'utf8');

test('farm alerts UI exposes history, destinations and scoped notification rules', () => {
  assert.match(index, /id="alertsBtn"/);
  assert.match(index, /id="alertsButtonCount"/);
  assert.match(index, /id="alertsSettingsBtn"/);
  assert.match(index, /id="alertsDialog"/);
  assert.match(index, /id="alertsHistory"/);
  assert.match(index, /id="alertDestinationForm"/);
  assert.match(index, /id="alertDestinationProvider"/);
  assert.match(index, /value="ntfy">ntfy/);
  assert.match(index, /value="webhook">Generic webhook/);
  assert.match(index, /id="alertRuleForm"/);
  assert.match(index, /id="alertRuleScope"/);
  assert.match(index, /value="printer">Individual printer/);
  assert.match(index, /value="group">Printer group/);
  assert.match(index, /value="model">Printer model/);
  assert.match(index, /src="\/alerts\.js"/);

  assert.match(alertsUi, /\/api\/alerts\?limit=100/);
  assert.match(alertsUi, /\/api\/alerts\/destinations/);
  assert.match(alertsUi, /\/api\/alerts\/rules/);
  assert.match(alertsUi, /\/api\/alerts\/mark-read/);
  assert.match(alertsUi, /Saved token — leave blank to keep/);
  assert.match(alertsUi, /pfc-alerts-live/);
  new vm.Script(alertsUi);
});

test('live fleet updates carry unread alert summaries to the top-bar indicator', () => {
  assert.match(server, /alerts:\{\s*unreadCount:alertService\.unreadCount\(\)/);
  assert.match(server, /recent:alertService\.listHistory\(\{ limit:5 \}\)/);
  assert.match(app, /function setAlertsSummary/);
  assert.match(app, /setAlertsSummary\(result\.alerts \|\| alertsSummaryState\)/);
  assert.match(app, /setAlertsSummary\(payload\.alerts \|\| alertsSummaryState\)/);
  assert.match(app, /new CustomEvent\('pfc-alerts-live'/);
  assert.match(styles, /\.controller-alert-button/);
  assert.match(styles, /\.alerts-dialog/);
});

test('alert backend provides persistent rules plus outbound ntfy and webhook providers', () => {
  assert.match(server, /new AlertService/);
  assert.match(server, /url\.pathname === '\/api\/alerts'/);
  assert.match(server, /url\.pathname === '\/api\/alerts\/mark-read'/);
  assert.match(alertService, /class AlertService/);
  assert.match(alertService, /scope\.type === 'group'/);
  assert.match(alertService, /duplicate:true/);
  assert.match(providers, /class NtfyNotificationProvider/);
  assert.match(providers, /class WebhookNotificationProvider/);
  assert.match(providers, /hasToken:Boolean\(config\.token\)/);
  assert.match(providers, /hasAuthorization:Boolean\(config\.authorization\)/);
});
