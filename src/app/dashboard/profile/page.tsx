import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { requireIdentity } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { ProfileForm } from "@/components/profile-form";
export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};
export default async function Profile() {
  const { user } = await requireIdentity();
  return (
    <Workspace title="Profile" user={user}>
      <section className="purchase-panel profile-panel">
        <h1>Your profile</h1>
        <p>Keep your account information up to date.</p>
        <ProfileForm
          fullName={
            typeof user.user_metadata.full_name === "string"
              ? user.user_metadata.full_name
              : ""
          }
          email={user.email || ""}
        />
        <div className="profile-security">
          <ShieldCheck size={25} />
          <div>
            <h2>Account security</h2>
            <p>
              Use a unique password and keep your verification links private.
            </p>
          </div>
          <Link href="/account?mode=reset" className="text-link">
            Change password
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </Workspace>
  );
}
