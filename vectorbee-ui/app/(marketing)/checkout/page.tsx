import { Suspense } from "react";
import CheckoutForm from "./checkout-form";

export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <CheckoutForm />
    </Suspense>
  );
}
