import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import prisma from "@/lib/prisma";
import { claimPendingJobById } from "@/lib/jobs/claim-job";
import { executeClaimedJob } from "@/lib/jobs/execute-job";

const VISIBILITY_SECONDS = 300;
const WAIT_SECONDS = 20;

export type SqsWorkerOptions = Readonly<{
  queueUrl: string;
  region: string;
}>;

function parseJobId(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "jobId" in parsed &&
      typeof (parsed as { jobId: unknown }).jobId === "string"
    ) {
      const id = (parsed as { jobId: string }).jobId.trim();
      return id.length > 0 ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Long-poll SQS and execute jobs by id. Deletes the message after successful handling or when
 * the job row is already in a terminal state (completed/failed) or missing (poison).
 */
export async function runSqsWorkerLoop(options: SqsWorkerOptions): Promise<void> {
  const client = new SQSClient({ region: options.region });
  console.info(
    JSON.stringify({
      event: "worker_start",
      transport: "sqs",
      queueUrl: options.queueUrl,
    }),
  );

  for (;;) {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: options.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: WAIT_SECONDS,
        VisibilityTimeout: VISIBILITY_SECONDS,
      }),
    );
    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      continue;
    }
    const message = messages[0]!;
    const receiptHandle = message.ReceiptHandle;
    const body = message.Body ?? "";
    const jobId = parseJobId(body);

    async function deleteMessage(): Promise<void> {
      if (!receiptHandle) {
        return;
      }
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: options.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
    }

    if (!jobId) {
      console.error(
        JSON.stringify({
          event: "sqs_bad_message",
          detail: "missing_or_invalid_jobId",
        }),
      );
      await deleteMessage();
      continue;
    }

    const claimed = await claimPendingJobById(jobId);
    if (claimed) {
      const outcome = await executeClaimedJob(claimed);
      console.info(
        JSON.stringify({
          event: "job_finished",
          jobId,
          transport: "sqs",
          outcome,
        }),
      );
      await deleteMessage();
      continue;
    }

    const existing = await prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) {
      await deleteMessage();
      continue;
    }
    if (existing.status === "COMPLETED" || existing.status === "FAILED") {
      await deleteMessage();
      continue;
    }
    // RUNNING: another worker owns execution; leave the message for redelivery after visibility.
    console.info(
      JSON.stringify({
        event: "sqs_deferred",
        jobId,
        status: existing.status,
      }),
    );
  }
}
