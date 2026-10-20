import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmailConfigurationComplete } from '../dist/emailConfig.js';

test('considera SMTP completo quando provedor e credenciais obrigatórias existem', () => {
  assert.equal(isEmailConfigurationComplete({ provider: 'smtp', host: 'smtp.example.test', user: 'mailer', password: 'secret' }), true);
});

test('considera e-mail não configurado sem permitir fallback silencioso', () => {
  assert.equal(isEmailConfigurationComplete({ provider: 'disabled', host: 'smtp.example.test', user: 'mailer', password: 'secret' }), false);
  assert.equal(isEmailConfigurationComplete({ provider: 'smtp', host: 'smtp.example.test', user: 'mailer' }), false);
});
