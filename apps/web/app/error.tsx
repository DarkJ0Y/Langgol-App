'use client'

import { Alert, Button, Card } from '@langgol/ui/components'

/**
 * Route-level error boundary.
 *
 * The user is shown a short, plain sentence and a retry. The `error` object is deliberately not
 * rendered: Next strips messages in production, but relying on that would be relying on a
 * framework detail to keep an internal message away from a farmer.
 */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <Alert tone="error">কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।</Alert>
      <p className="lg-hint" lang="en">
        Something went wrong. Please try again.
      </p>
      <Button type="button" onClick={reset}>
        আবার চেষ্টা করুন / Try again
      </Button>
    </Card>
  )
}
