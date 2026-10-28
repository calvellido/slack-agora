import type { ModalView } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import { within } from '#src/lib/time.ts';

/**
 * How long a form waits for what it sends before saying it is sending. Slack waits 3 seconds for the form's answer,
 * counted from before the bot gets it, and then shows the person an error, though what they sent may have gone.
 */
export const SEND_WAIT_MS = 2_000;

/** A form's answer: errors under its fields, another view in its place, or, with none, closing it. */
export type Answer =
  | { response_action: 'errors'; errors: Record<string, string> }
  | { response_action: 'update'; view: ModalView }
  | undefined;

/** A form just submitted: `received` is when its handler started. */
export interface Submitted {
  ack: (answer?: Answer) => Promise<void>;
  client: WebClient;
  viewId: string;
  received: number;
}

/** What a form answered late shows in its place, as `notice`s: while sending, and once done. */
export interface Late {
  notice: (text: string) => ModalView;
  sending: string;
  /** For a form that would have closed. */
  done: string;
  /** If answering failed unexpectedly. */
  failed: string;
}

/**
 * Answers a form with what `answering` gives, if it does within `waitMs` of the form arriving: the person sees how it
 * went, or the errors with what they wrote still in the form. Past that, the form says it is sending, and then how it
 * went: errors and closing as notices. Returns the answer.
 */
export async function answerInTime(
  form: Submitted,
  answering: Promise<Answer>,
  late: Late,
  waitMs = SEND_WAIT_MS,
): Promise<Answer> {
  const answered = await within(answering, waitMs - (Date.now() - form.received)).catch(async (error: unknown) => {
    await form.ack({ response_action: 'update', view: late.notice(late.failed) });
    throw error;
  });
  if (answered.done) {
    await form.ack(answered.value);
    return answered.value;
  }
  await form.ack({ response_action: 'update', view: late.notice(late.sending) });
  // The person may have closed it meanwhile.
  const show = (view: ModalView) => form.client.views.update({ view_id: form.viewId, view }).catch(() => {});
  const answer = await answering.catch(async (error: unknown) => {
    await show(late.notice(late.failed));
    throw error;
  });
  if (answer?.response_action === 'update') await show(answer.view);
  else await show(late.notice(answer ? Object.values(answer.errors).join('\n') : late.done));
  return answer;
}
