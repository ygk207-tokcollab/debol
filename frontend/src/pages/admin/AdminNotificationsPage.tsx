import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BellRing, ChevronDown, KeyRound, RefreshCw, Send, ShieldAlert, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { KeyValue, SectionCard, SelectField, TextField, ToggleField } from '../../components/form';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { StatusPill } from '../../components/StatusPill';
import { adminNotifications, adminOrders } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatPhone, relativeTime, titleCase } from '../../lib/format';
import { normalizeEthiopianPhone } from '../../lib/validation';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { OutboxRow, TelegramStatus } from '../../lib/types';

/** The status payload also carries these two URLs; the shared type does not name them yet. */
interface TelegramStatusView extends TelegramStatus {
  miniAppUrl?: string | null;
  adminPanelUrl?: string | null;
}

interface Outcome {
  id: number;
  text: string;
  delivered: boolean;
}

/** PUT /admin/telegram/config body exactly as TelegramConfigBody declares it. */
interface TelegramConfigBody {
  contactPhone?: string;
  botUsername?: string;
  miniAppUrl?: string;
  adminNotifyUrl?: string;
  enabled?: boolean;
}

const STATUSES = ['PENDING', 'SENDING', 'SENT', 'RETRY', 'DEAD_LETTER', 'CANCELLED'];
const EVENTS = [
  'NEW_ORDER', 'ORDER_CONFIRMED', 'ORDER_DELIVERED', 'CASH_COLLECTED', 'CANCEL_REQUEST', 'ORDER_CANCELLED',
  'FAILED_DELIVERY', 'LOW_STOCK', 'OUT_OF_STOCK', 'TEST',
];

let outcomeSequence = 1;

/**
 * Turns one outbox row into a truthful sentence. Only SENT means the alert reached the chat; a row
 * requeued while Telegram is not ready is reported as still undelivered, with the server's own error.
 */
function describeRow(row: OutboxRow | undefined): string {
  if (!row) return 'The outbox no longer shows that row on the first page, so its state could not be read back.';
  if (row.status === 'SENT') {
    return `Row ${row.id} (${row.eventType}) was delivered to chat ${row.chatId ?? '-'} at ${formatDateTime(row.sentAt)}.`;
  }
  if (row.status === 'SENDING') {
    return `Row ${row.id} (${row.eventType}) is being sent now - not confirmed yet.`;
  }
  const error = row.lastError ? ` Server error: ${row.lastError}.` : '';
  if (row.status === 'DEAD_LETTER') {
    return `Row ${row.id} (${row.eventType}) went to dead letter after ${row.attempts}/${row.maxAttempts} attempts.${error} Not delivered.`;
  }
  return `Row ${row.id} (${row.eventType}) is ${row.status} after ${row.attempts}/${row.maxAttempts} attempts, next try ${formatDateTime(row.nextAttemptAt)}.${error} Not delivered.`;
}

export default function AdminNotificationsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();

  // The outbox routes need ROLE_MANAGER (owner and manager both hold it); the Telegram routes are
  // OWNER-only, and the client permission list mirrors that.
  const outboxAllowed = can('notifications') || can(PERMISSION.telegram);
  const telegramAllowed = can(PERMISSION.telegram);

  const [filters, setFilters] = useState({ status: '', event: '', page: 0, size: 25 });
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; instructions: string } | null>(null);
  const [telegramForm, setTelegramForm] = useState<{
    contactPhone: string;
    botUsername: string;
    miniAppUrl: string;
    adminNotifyUrl: string;
    enabled: boolean | null;
  }>({ contactPhone: '', botUsername: '', miniAppUrl: '', adminNotifyUrl: '', enabled: null });
  const [telegramErrors, setTelegramErrors] = useState<Record<string, string>>({});
  const [registerForm, setRegisterForm] = useState({ telegramUserId: '', chatId: '' });
  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});
  const [orderIdText, setOrderIdText] = useState('');

  function record(text: string, delivered: boolean) {
    setOutcomes((current) => [{ id: outcomeSequence++, text, delivered }, ...current].slice(0, 6));
  }

  const status = useQuery({
    queryKey: ['admin', 'telegram', 'status'],
    queryFn: adminNotifications.telegramStatus,
    enabled: telegramAllowed,
    retry: false,
  });
  const view = status.data as TelegramStatusView | undefined;

  const list = useQuery({
    queryKey: ['admin', 'notifications', filters],
    queryFn: () =>
      adminNotifications.list({
        status: filters.status || undefined,
        event: filters.event || undefined,
        page: filters.page,
        size: filters.size,
      }),
    enabled: outboxAllowed,
    retry: false,
  });

  const saveTelegram = useMutation({
    mutationFn: () => {
      /**
       * TelegramConfigBody on the server also carries contactPhone (the number a pairing code is
       * bound to); the shared client type has not caught up, so the body is declared here.
       */
      const body: TelegramConfigBody = {
        contactPhone: telegramForm.contactPhone.trim() || undefined,
        botUsername: telegramForm.botUsername.trim() || undefined,
        miniAppUrl: telegramForm.miniAppUrl.trim() || undefined,
        adminNotifyUrl: telegramForm.adminNotifyUrl.trim() || undefined,
        // null means the operator did not touch the switch, so the stored value stays as it is.
        enabled: telegramForm.enabled ?? undefined,
      };
      return adminNotifications.saveTelegram(body);
    },
    onSuccess: (next) => {
      client.invalidateQueries({ queryKey: ['admin', 'telegram'] });
      client.invalidateQueries({ queryKey: ['admin', 'settings'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      record(
        next.ready
          ? 'Configuration saved; the server now reports the alert path as ready.'
          : `Configuration saved, but the server still reports not ready: ${next.warning ?? 'see the checklist above.'}`,
        Boolean(next.ready),
      );
      toast.push('Telegram configuration saved.', 'ok');
    },
  });

  const issueCode = useMutation({
    mutationFn: adminNotifications.pairingCode,
    onSuccess: (code) => {
      client.invalidateQueries({ queryKey: ['admin', 'telegram'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setPairing(code);
      toast.push('Pairing code issued - it expires on its own.', 'ok');
    },
  });

  const register = useMutation({
    mutationFn: (body: { telegramUserId: number; chatId: number }) => adminNotifications.registerChat(body),
    onSuccess: (next) => {
      client.invalidateQueries({ queryKey: ['admin', 'telegram'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      setRegisterForm({ telegramUserId: '', chatId: '' });
      record(
        next.ready
          ? `Manual pairing accepted: chat ${next.adminChatId ?? '-'} is now the alert destination and the server queued a test alert.`
          : `Manual pairing stored chat ${next.adminChatId ?? '-'}, but alerts are still not sendable: ${next.warning ?? 'token or switch missing.'}`,
        Boolean(next.ready),
      );
      toast.push(
        'Chat registered. Check the queue after the next dispatch.',
        next.ready ? 'ok' : 'warn',
      );
    },
  });

  const retryRow = useMutation({
    mutationFn: async (row: OutboxRow) => {
      const queued = (await adminNotifications.retry(row.id)) as unknown as { queued?: boolean; status?: string };
      const refreshed = await adminNotifications.list({ page: 0, size: 100 });
      const after = refreshed.items.find((item) => item.id === row.id);
      return { queued, after };
    },
    onSuccess: ({ after }) => {
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      record(describeRow(after), after?.status === 'SENT');
      toast.push(
        after?.status === 'SENT'
          ? 'Delivered.'
          : 'Requeued - not delivered yet.',
        after?.status === 'SENT' ? 'ok' : 'warn',
      );
    },
  });

  const retryAll = useMutation({
    mutationFn: async () => {
      const result = (await adminNotifications.retryAll()) as unknown as { queued?: number; telegramReady?: boolean };
      const refreshed = await adminNotifications.list({ page: 0, size: 1 });
      return { result, refreshed };
    },
    onSuccess: ({ result, refreshed }) => {
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      const counts = Object.entries(refreshed.counts ?? {})
        .map(([key, value]) => `${titleCase(key)} ${value}`)
        .join(' · ');
      record(
        `${result.queued ?? 0} row(s) requeued. Telegram ready on the server: ${
          result.telegramReady ? 'yes' : 'no'
        }. Outbox now: ${counts || 'empty'}.`,
        Boolean(result.telegramReady),
      );
      toast.push(
        result.telegramReady
          ? `${result.queued ?? 0} queued - dispatch to send them.`
          : `${result.queued ?? 0} requeued, but they stay in RETRY while Telegram is not ready.`,
        result.telegramReady ? 'ok' : 'warn',
      );
    },
  });

  const dispatch = useMutation({
    mutationFn: async () => {
      await adminNotifications.dispatch();
      const refreshed = await adminNotifications.list({ page: 0, size: 100 });
      return refreshed;
    },
    onSuccess: (refreshed) => {
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      const stuck = refreshed.items.filter((row) => row.status !== 'SENT');
      const counts = Object.entries(refreshed.counts ?? {})
        .map(([key, value]) => `${titleCase(key)} ${value}`)
        .join(' · ');
      record(
        `Dispatch cycle finished. Outbox: ${counts || 'empty'}. ` +
          (stuck.length === 0
            ? 'Every row on this page is now SENT.'
            : `${stuck.length} row(s) still undelivered - ${stuck
                .slice(0, 3)
                .map((row) => `#${row.id} ${row.status}${row.lastError ? ` (${row.lastError})` : ''}`)
                .join('; ')}`),
        stuck.length === 0,
      );
      toast.push(
        stuck.length === 0
          ? 'Dispatched: nothing left pending.'
          : `${stuck.length} row(s) still failed after dispatch.`,
        stuck.length === 0 ? 'ok' : 'warn',
      );
    },
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      await adminNotifications.sendTest();
      await adminNotifications.dispatch();
      const refreshed = await adminNotifications.list({ event: 'TEST', page: 0, size: 5 });
      return refreshed.items[0];
    },
    onSuccess: (row) => {
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      record(describeRow(row), row?.status === 'SENT');
      toast.push(
        row?.status === 'SENT'
          ? 'Test alert delivered to the paired chat.'
          : 'Test alert queued but not delivered.',
        row?.status === 'SENT' ? 'ok' : 'warn',
      );
    },
  });

  const retryOrder = useMutation({
    mutationFn: async (orderId: number) =>
      (await adminOrders.retryNotifications(orderId)) as unknown as { retried?: number; telegram?: TelegramStatus },
    onSuccess: (result, orderId) => {
      client.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      const ready = result.telegram?.ready === true;
      record(
        result.retried
          ? `${result.retried} alert row(s) for order id ${orderId} requeued${
              ready
                ? '; the server reports the Telegram path as ready, so the next dispatch will attempt them'
                : ` - still not sendable: ${result.telegram?.warning ?? 'the administrator chat is not paired'}`
            }.`
          : `Order id ${orderId} has no undelivered alert row - every notification for it is already SENT, so 0 were requeued.`,
        ready && Boolean(result.retried),
      );
      toast.push(
        result.retried
          ? `${result.retried} row(s) requeued for that order.`
          : 'Nothing to retry for that order.',
        ready && result.retried ? 'ok' : 'warn',
      );
    },
  });

  function handleTelegramSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (telegramForm.contactPhone.trim()) {
      const normalized = normalizeEthiopianPhone(telegramForm.contactPhone);
      if (!normalized) errors.contactPhone = 'That is not a valid Ethiopian mobile number.';
    }
    setTelegramErrors(errors);
    if (Object.keys(errors).length > 0) return;
    saveTelegram.mutate();
  }

  function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    const rawChat = registerForm.chatId.trim();
    const userId = Number(registerForm.telegramUserId.trim());
    const chatId = Number(rawChat);
    if (!Number.isFinite(userId) || !Number.isInteger(userId) || userId <= 0) {
      errors.telegramUserId = 'A Telegram user id is a positive number, for example 777001.';
    }
    if (!Number.isFinite(chatId) || !Number.isInteger(chatId) || chatId === 0) {
      errors.chatId = 'A chat id is a non-zero number - negative for a group chat.';
    }
    if (/^0[79]\d{8}$/.test(rawChat.replace(/[\s-]/g, ''))) {
      errors.chatId =
        '0911526922-style numbers are phone numbers, not chat ids. A chat id comes from Telegram itself.';
    }
    setRegisterErrors(errors);
    if (Object.keys(errors).length > 0) return;
    register.mutate({ telegramUserId: userId, chatId });
  }

  const missing: string[] = [];
  if (view) {
    if (!view.enabled) missing.push('Telegram alerts are switched off in store settings.');
    if (!view.botTokenConfigured) {
      missing.push('No bot token is configured on the server (TELEGRAM_BOT_TOKEN), so nothing can be sent.');
    }
    if (!view.setupComplete) missing.push('The bot has no paired administrator chat yet.');
    if (view.adminChatId == null) missing.push('No chat id stored, so there is nowhere to send.');
  }

  const rows: OutboxRow[] = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{'Alert control room'}</p>
        <h1 className="font-display text-xl leading-tight text-ink">{t('admin.notifications')}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          {'Telegram delivery and the outbox queue, read straight from the notification_outbox table. This screen never shows a bot token: the server reports only whether one is configured, and the token stays in its own environment.'}
        </p>
      </div>

      {!outboxAllowed && (
        <div className="card flex items-start gap-3 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-error-600" aria-hidden />
          <p className="text-sm text-ink-soft">
            {'Your role may not read the notification queue, so the table below stays empty and the retry buttons are hidden.'}
          </p>
        </div>
      )}

      {!telegramAllowed && outboxAllowed && (
        <p className="rounded-md border border-surface-300 bg-surface-100 px-4 py-3 text-sm text-ink-soft">
          {'The queue below is yours to retry, but pairing and the alert switch are owner-only routes: ask an owner for the Telegram setup section.'}
        </p>
      )}

      {telegramAllowed && (
        <SectionCard
          title={'Is the alert path actually working?'}
          description={'Everything here is what /admin/telegram/status returns for the stored settings row - no guesswork.'}
          actions={
            <button type="button" className="btn-quiet" onClick={() => status.refetch()} disabled={status.isFetching}>
              <RefreshCw className="size-4" aria-hidden />
              {'Re-check'}
            </button>
          }
        >
          {status.isLoading && <LoadingRows rows={2} />}
          {status.isError && <ErrorState error={status.error} onRetry={() => status.refetch()} />}

          {view && (
            <div className="space-y-3">
              {view.ready && view.botTokenConfigured ? (
                <div className="flex items-start gap-3 rounded-md border border-secondary-300 bg-secondary-100 px-4 py-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary-600" aria-hidden />
                  <p className="text-sm text-primary-700">
                    {t('admin.telegramReady', { chat: String(view.adminChatId ?? '-') })}{' '}
                    {'Delivery of each individual alert is still only proven by the queue below - check a row shows SENT.'}
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-error-300/60 bg-error-100/60 px-4 py-3">
                  <p className="flex items-start gap-2 text-sm font-medium text-error-600">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {'Order alerts have NOT been delivered to any chat. What is missing:'}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-error-600">
                    {missing.length === 0 ? (
                      <li>
                        {view.warning ??
                          'The server gave no reason; re-check the status.'}
                      </li>
                    ) : (
                      missing.map((item) => <li key={item}>{item}</li>)
                    )}
                  </ul>
                  {!view.pollingEnabled && (
                    <p className="mt-2 text-xs text-ink-mute">
                      {'The server is not polling the bot right now, so a /pair code typed into Telegram cannot be consumed. The manual chat registration below still works and is audited.'}
                    </p>
                  )}
                </div>
              )}

              {view.warning && (
                <p className="text-sm text-ink-soft">{'Server warning'}: {view.warning}</p>
              )}

              <dl>
                <KeyValue
                  label={'Bot token configured on the server'}
                  value={view.botTokenConfigured ? t('common.yes') : t('common.no')}
                />
                <KeyValue label={t('admin.botUsername')} value={view.botUsername ? `@${view.botUsername}` : '—'} />
                <KeyValue
                  label={'Alerts switched on'}
                  value={view.enabled ? t('common.yes') : t('common.no')}
                />
                <KeyValue label={t('admin.connectedChat')} value={view.adminChatId ?? 'none'} mono />
                <KeyValue
                  label={'Paired Telegram user id'}
                  value={view.adminTelegramUserId ?? 'none'}
                  mono
                />
                <KeyValue
                  label={t('admin.adminPhone')}
                  value={view.adminContactPhone ? formatPhone(view.adminContactPhone) : 'not set'}
                  mono
                />
                <KeyValue
                  label={'Mini app URL'}
                  value={view.miniAppUrl ?? 'not set'}
                />
                <KeyValue
                  label={'Admin panel URL'}
                  value={view.adminPanelUrl ?? 'not set'}
                />
                <KeyValue
                  label={'Server polls the bot'}
                  value={view.pollingEnabled ? t('common.yes') : t('common.no')}
                />
                <KeyValue label={t('admin.telegramSetup')} value={view.setupComplete ? t('common.yes') : t('common.no')} />
              </dl>

              <form onSubmit={handleTelegramSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('admin.adminPhone')}
                  name="contactPhone"
                  type="tel"
                  inputMode="tel"
                  hint={'A phone number used to bind the pairing code - it is not a chat id. Blank keeps the stored value.'}
                  placeholder={view.adminContactPhone ?? ''}
                  value={telegramForm.contactPhone}
                  error={telegramErrors.contactPhone}
                  onChange={(e) => setTelegramForm({ ...telegramForm, contactPhone: e.target.value })}
                />
                <TextField
                  label={t('admin.botUsername')}
                  name="botUsername"
                  hint={'Display name for buttons and replies only.'}
                  placeholder={view.botUsername ?? ''}
                  value={telegramForm.botUsername}
                  onChange={(e) => setTelegramForm({ ...telegramForm, botUsername: e.target.value })}
                />
                <TextField
                  label={'Mini app URL'}
                  name="miniAppUrl"
                  type="url"
                  placeholder={view.miniAppUrl ?? ''}
                  value={telegramForm.miniAppUrl}
                  onChange={(e) => setTelegramForm({ ...telegramForm, miniAppUrl: e.target.value })}
                />
                <TextField
                  label={'Admin panel URL'}
                  name="adminNotifyUrl"
                  type="url"
                  placeholder={view.adminPanelUrl ?? ''}
                  value={telegramForm.adminNotifyUrl}
                  onChange={(e) => setTelegramForm({ ...telegramForm, adminNotifyUrl: e.target.value })}
                />
                <div className="sm:col-span-2">
                  <ToggleField
                    label={'Send order alerts to Telegram'}
                    checked={telegramForm.enabled ?? view.enabled}
                    hint={'Stored on the settings row; the same switch lives on the settings screen. Untouched, this save leaves it as it is.'}
                    onChange={(next) => setTelegramForm({ ...telegramForm, enabled: next })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <button type="submit" className="btn-primary" disabled={saveTelegram.isPending}>
                    <BellRing className="size-4" aria-hidden />
                    {saveTelegram.isPending ? t('admin.saving') : 'Save Telegram configuration'}
                  </button>
                  <Link to="/admin/settings" className="btn-quiet">
                    {t('admin.settings')}
                  </Link>
                  <span className="text-xs text-ink-mute">
                    {'There is no token field on purpose: the request body this form can send has no place for a token.'}
                  </span>
                </div>
                {saveTelegram.isError && (
                  <p role="alert" className="text-sm text-error-600 sm:col-span-2">
                    {saveTelegram.error instanceof ApiError
                      ? saveTelegram.error.message
                      : 'The server refused the configuration.'}
                  </p>
                )}
              </form>
            </div>
          )}
        </SectionCard>
      )}

      {telegramAllowed && (
        <SectionCard
          title={'Pair the administrator chat'}
          description={'Two routes. A pairing code is the safe one: the server issues a single-use numeric code bound to the configured contact number, and only the bot update that carries it can register a chat - the callback is re-authorized against the stored chat id, never trusted because a button was pressed. Manual registration writes the ids you read inside Telegram, and the server refuses zero or negative user ids.'}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-md border border-surface-300 bg-surface-100 px-4 py-3">
              <h3 className="font-display text-base text-ink">{t('admin.pairingCode')}</h3>
              <p className="text-xs text-ink-soft">{t('admin.pairingHelp')}</p>
              <button type="button" className="btn-secondary" onClick={() => issueCode.mutate()} disabled={issueCode.isPending}>
                <KeyRound className="size-4" aria-hidden />
                {issueCode.isPending ? t('admin.loading') : t('admin.pairingCode')}
              </button>
              {issueCode.isError && (
                <p role="alert" className="text-sm text-error-600">
                  {issueCode.error instanceof ApiError
                    ? issueCode.error.message
                    : 'No code was issued.'}
                </p>
              )}
              {pairing && (
                <div className="rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700">
                  <p className="font-mono text-lg">{pairing.code}</p>
                  <p className="mt-1 text-xs">{pairing.instructions}</p>
                  <p className="mt-1 text-xs">
                    {'Expires'} {formatDateTime(pairing.expiresAt)} ·{' '}
                    {'single use, not stored in the browser'}.
                  </p>
                </div>
              )}
              {view && view.pendingPairingCodes.length > 0 && (
                <p className="text-xs text-ink-mute">
                  {`${view.pendingPairingCodes.length} code(s) still waiting on the server; the values are not repeated here.`}
                </p>
              )}
            </div>

            <form onSubmit={handleRegisterSubmit} noValidate className="space-y-3 rounded-md border border-surface-300 px-4 py-3">
              <h3 className="font-display text-base text-ink">
                {'Register the chat by id'}
              </h3>
              <TextField
                label={'Telegram user id'}
                name="telegramUserId"
                inputMode="numeric"
                hint={'For example 777001 - the number Telegram assigns to the person.'}
                value={registerForm.telegramUserId}
                error={registerErrors.telegramUserId}
                onChange={(e) => setRegisterForm({ ...registerForm, telegramUserId: e.target.value })}
              />
              <TextField
                label={'Chat id'}
                name="chatId"
                inputMode="numeric"
                hint={'From the chat the bot must write to. 0911526922 is the shop phone number, NOT a chat id - typing it here does not pair anything.'}
                value={registerForm.chatId}
                error={registerErrors.chatId}
                onChange={(e) => setRegisterForm({ ...registerForm, chatId: e.target.value })}
              />
              <button type="submit" className="btn-primary" disabled={register.isPending}>
                <Send className="size-4" aria-hidden />
                {register.isPending ? t('admin.loading') : 'Register chat'}
              </button>
              <p className="text-xs text-ink-mute">
                {'The server stores the ids on the settings row, stamps the audit trail with your email, and queues a test alert so the queue below proves whether it really arrived.'}
              </p>
              {register.isError && (
                <p role="alert" className="text-sm text-error-600">
                  {register.error instanceof ApiError
                    ? register.error.message
                    : 'Registration failed.'}
                </p>
              )}
            </form>
          </div>
        </SectionCard>
      )}

      {outboxAllowed && (
        <SectionCard
          title={t('admin.outboxTitle')}
          description={'One row per alert the store tried to send. Status, attempts and the error text are the stored values, so a row that did not arrive still says so.'}
          actions={
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => retryAll.mutate()} disabled={retryAll.isPending}>
                {t('admin.retryAll')}
              </button>
              <button type="button" className="btn-primary" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
                <RefreshCw className="size-4" aria-hidden />
                {t('admin.dispatchNow')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
                <Send className="size-4" aria-hidden />
                {t('admin.testNotification')}
              </button>
            </div>
          }
        >
          {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}

          {(retryRow.isError || retryAll.isError || dispatch.isError || sendTest.isError || retryOrder.isError) && (
            <p
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {(() => {
                const failure =
                  retryRow.error ?? retryAll.error ?? dispatch.error ?? sendTest.error ?? retryOrder.error;
                return failure instanceof ApiError
                  ? failure.message
                  : 'The server refused that request.';
              })()}
            </p>
          )}

          {Object.keys(counts).length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(counts).map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-full border border-surface-300 bg-surface-100 px-3 py-1 text-xs text-ink-soft"
                >
                  {titleCase(key)} · {value}
                </span>
              ))}
              <span className="rounded-full border border-surface-300 px-3 py-1 text-xs text-ink-mute">
                {'counts over the whole table'}
              </span>
            </div>
          )}

          {outcomes.length > 0 && (
            <ul className="mb-3 space-y-1">
              {outcomes.map((outcome) => (
                <li
                  key={outcome.id}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    outcome.delivered
                      ? 'border-secondary-300 bg-secondary-100 text-primary-700'
                      : 'border-error-300/60 bg-error-100/60 text-error-600'
                  }`}
                >
                  {outcome.text}
                </li>
              ))}
            </ul>
          )}

          <form
            className="mb-4 grid gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({ ...filters, page: 0 });
              setOpenRow(null);
            }}
          >
            <SelectField
              label={'Status (server)'}
              name="status"
              placeholder={'Any status'}
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              options={STATUSES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <SelectField
              label={'Event (server)'}
              name="event"
              placeholder={'Any event'}
              value={filters.event}
              onChange={(e) => setFilters({ ...filters, event: e.target.value })}
              options={EVENTS.map((value) => ({ value, label: titleCase(value) }))}
            />
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-secondary">
                {'Apply'}
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setFilters({ status: '', event: '', page: 0, size: 25 })}
              >
                {'Reset'}
              </button>
            </div>
            <div className="rounded-md border border-surface-300 bg-surface-100 px-3 py-2 text-xs text-ink-soft">
              {'The server filters inside the page it reads, so a filtered page can look shorter than the page size while more rows exist.'}
            </div>
          </form>

          {telegramAllowed && (
            <form
              className="mb-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const id = Number(orderIdText.trim());
                if (!Number.isInteger(id) || id <= 0) return;
                retryOrder.mutate(id);
              }}
            >
              <TextField
                label={'Retry every undelivered alert for one order'}
                name="orderId"
                inputMode="numeric"
                className="sm:max-w-xs"
                hint={'The numeric order id from the orders screen, not ORD-2026-00001.'}
                value={orderIdText}
                onChange={(e) => setOrderIdText(e.target.value)}
              />
              <button type="submit" className="btn-secondary" disabled={retryOrder.isPending || !orderIdText.trim()}>
                {retryOrder.isPending ? t('admin.loading') : t('admin.retry')}
              </button>
            </form>
          )}

          {list.isLoading && <LoadingRows rows={4} />}

          {!list.isLoading && rows.length === 0 && (
            <EmptyState
              title={'No alert rows on this page'}
              body={'Rows appear as soon as an order is placed, a status changes, cash is collected or stock runs low.'}
            />
          )}

          {rows.length > 0 && (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-300 text-xs uppercase tracking-wide text-ink-mute">
                    <th className="py-2 pr-3 font-semibold">{'Event'}</th>
                    <th className="py-2 pr-3 font-semibold">{'Status'}</th>
                    <th className="py-2 pr-3 font-semibold">{'Order'}</th>
                    <th className="py-2 pr-3 font-semibold">{t('admin.attempts')}</th>
                    <th className="py-2 pr-3 font-semibold">{t('admin.nextTry')}</th>
                    <th className="py-2 pr-3 font-semibold">{t('admin.lastError')}</th>
                    <th className="py-2 font-semibold text-right">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const open = openRow === row.id;
                    return (
                      <tr key={row.id} className="border-b border-surface-200 align-top last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="block font-medium text-ink">{titleCase(row.eventType)}</span>
                          <span className="block text-xs text-ink-mute">
                            {'created'} {formatDateTime(row.createdAt)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusPill value={row.status} />
                          {row.sentAt && (
                            <span className="mt-1 block text-xs text-ink-mute">
                              {t('admin.sent')} {formatDateTime(row.sentAt)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          {row.orderNumber ? (
                            <span className="block text-ink-soft">
                              {row.orderNumber}
                              <span className="block text-xs text-ink-mute">chat {row.chatId ?? '—'}</span>
                            </span>
                          ) : (
                            <span className="text-ink-mute">
                              {row.chatId ?? 'no chat'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-ink-soft">
                          {row.attempts}/{row.maxAttempts}
                        </td>
                        <td className="py-2.5 pr-3 text-ink-soft">
                          {formatDateTime(row.nextAttemptAt)}
                          <span className="block text-xs text-ink-mute">{relativeTime(row.nextAttemptAt)}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <button
                            type="button"
                            className="flex w-full items-start gap-2 text-left"
                            onClick={() => setOpenRow(open ? null : row.id)}
                          >
                            <span className="flex-1 break-words text-ink-soft">
                              {row.lastError ?? 'no error recorded'}
                            </span>
                            <ChevronDown
                              className={`mt-0.5 size-4 shrink-0 text-ink-mute ${open ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                          </button>
                          {open && (
                            <div className="mt-2 space-y-2 rounded-md border border-surface-300 bg-surface-100 px-3 py-2 text-xs text-ink-soft">
                              <p>
                                {'Message body the bot sends'}{' '}
                                <span className="font-medium text-ink">#{row.id}</span>
                              </p>
                              <pre className="whitespace-pre-wrap break-words font-sans text-ink">{row.message}</pre>
                              {row.adminLink && (
                                <a
                                  href={row.adminLink}
                                  className="text-primary-600 underline underline-offset-2 transition-colors hover:text-primary-700"
                                >
                                  {t('admin.orderLink')}
                                </a>
                              )}
                              <p>
                                {'Inline action buttons'}:{' '}
                                {row.inlineActions ? t('common.yes') : t('common.no')} ·{' '}
                                {'last attempt'} {formatDateTime(row.lastAttemptAt)}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1"
                            disabled={retryRow.isPending || row.status === 'SENT'}
                            onClick={() => retryRow.mutate(row)}
                          >
                            {t('admin.retry')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-mute">
              {`Page ${(list.data?.page ?? filters.page) + 1} of ${Math.max(list.data?.totalPages ?? 1, 1)} · ${
                  list.data?.totalElements ?? 0
                } rows in the table`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page === 0}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                {'Newer page'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={(list.data?.totalPages ?? 1) <= filters.page + 1}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                {'Older page'}
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      <p className="px-1 text-xs text-ink-mute">
        {'Nothing on this screen ever asks for, echoes, or stores a bot token. The only token-related fact the API exposes is the boolean above, and the pairing code shown here is single-use and expires on its own.'}
      </p>
    </div>
  );
}
