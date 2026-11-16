import type { SNSEvent } from 'aws-lambda';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

interface CloudWatchAlarmPayload {
  AlarmName?: string;
  AlarmDescription?: string;
  NewStateValue?: string;
  NewStateReason?: string;
  StateChangeTime?: string;
  Region?: string;
}

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, service: 'alert-forwarder', message, ...meta }));
}

function formatAlarmMessage(rawMessage: string, subject?: string): string {
  try {
    const alarm = JSON.parse(rawMessage) as CloudWatchAlarmPayload;
    if (alarm.AlarmName) {
      const icon = alarm.NewStateValue === 'ALARM' ? '🚨' : '✅';
      return [
        `${icon} *PolyFlash CloudWatch Alert*`,
        `*Alarm:* \`${alarm.AlarmName}\``,
        `*State:* \`${alarm.NewStateValue ?? 'UNKNOWN'}\``,
        alarm.Region ? `*Region:* \`${alarm.Region}\`` : null,
        alarm.StateChangeTime ? `*Time:* \`${alarm.StateChangeTime}\`` : null,
        alarm.NewStateReason ? `*Reason:* ${alarm.NewStateReason}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }
  } catch {
    // Fallback to plain text if SNS message is not JSON
  }

  return `🚨 *PolyFlash Alert*${subject ? `\n*Subject:* ${subject}` : ''}\n${rawMessage}`;
}

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('WARN', 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID, skipping notification');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error (${response.status}): ${body}`);
  }
}

export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    const start = Date.now();
    const { Message, Subject, MessageId } = record.Sns;

    try {
      const formatted = formatAlarmMessage(Message, Subject);
      await sendTelegramMessage(formatted);

      log('INFO', 'Forwarded SNS alert to Telegram', {
        messageId: MessageId,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log('ERROR', 'Failed to forward SNS alert', {
        messageId: MessageId,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }
}
