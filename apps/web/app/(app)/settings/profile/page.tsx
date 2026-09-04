import * as React from "react";
import { ProfileView } from "~/components/app/admin/profile-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/**
 * The page was static markup asserting that names and emails are not stored
 * here. They are — `app_users` holds all three — and there was simply no
 * endpoint to change them. See `profile-view.tsx`.
 */
export default function ProfilePage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ProfileView />
    </React.Suspense>
  );
}
