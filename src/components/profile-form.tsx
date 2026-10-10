"use client";
import { useActionState } from "react";
import { updateProfile } from "@/app/dashboard/profile/actions";
export function ProfileForm({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const [state, action, pending] = useActionState(updateProfile, {});
  return (
    <form action={action} className="profile-form">
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="form-message" role="status">
          {state.message}
        </p>
      )}
      <fieldset disabled={pending}>
        <label>
          Full Name
          <input
            name="fullName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={fullName}
          />
        </label>
        <label>
          Email Address
          <input type="email" readOnly value={email} />
        </label>
        <p>
          Your verified email is managed through your authentication provider.
        </p>
        <button className="button button-dark">
          {pending ? "Saving…" : "Save changes"}
        </button>
      </fieldset>
    </form>
  );
}
