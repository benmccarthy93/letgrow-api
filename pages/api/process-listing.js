// /pages/api/queues/process-listing.ts
import { handleNodeCallback } from "@vercel/queue"

const APP_BASE_URL = process.env.APP_BASE_URL
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET

type QueueMessage = {
  job_id?: string
  submission_id?: string
}

export default handleNodeCallback<QueueMessage>(async (message, metadata) => {

  if (!APP_BASE_URL || !INTERNAL_API_SECRET) {
    throw new Error("Missing APP_BASE_URL or INTERNAL_API_SECRET")
  }

  const jobId = message?.job_id

  if (!jobId) {
    throw new Error("Queue message missing job_id")
  }

  const response = await fetch(
    `${APP_BASE_URL.replace(/\/+$/, "")}/api/process-next`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_API_SECRET,
        "x-queue-message-id": metadata.messageId
      },
      body: JSON.stringify({
        job_id: jobId
      })
    }
  )

  let data = null

  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    console.error("Queue consumer failed calling process-next", {
      messageId: metadata.messageId,
      status: response.status,
      body: data
    })

    throw new Error(
      data?.error || `process-next failed with status ${response.status}`
    )
  }

  console.log("Queue job processed successfully", {
    messageId: metadata.messageId,
    jobId
  })

})
