import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { AuthForm } from "./auth-form";
import {
  VerifiedScreen, LinkExpiredScreen, LinkUsedScreen, AcceptInviteScreen, LockedOutScreen,
} from "./status-screens";
import { mapOAuthError } from "./auth-errors";
import { Onboarding } from "~/components/app/onboarding/onboarding";

/**
 * Auth — every state, both themes.
 *
 * Sign-in is federated only: three OAuth providers, plus a contact route for
 * enterprise SAML. There is no password anywhere in this flow, so the failure
 * states are exactly the ones the provider round-trip can produce, driven
 * through the REAL mapper with the codes our routes emit.
 *
 * The password stories that used to live here — verify email, forgot password,
 * choose password — are gone with the screens themselves.
 */

const meta = { title: "Flows/Auth", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  render: () => <AuthForm mode="signin" />,
};

export const SignInHandingOff: Story = {
  name: "Sign in — handing off to the provider",
  render: () => <AuthForm mode="signin" loading />,
};

export const SignInProviderUnreachable: Story = {
  name: "Sign in — provider unreachable",
  render: () => <AuthForm mode="signin" error={mapOAuthError("oauth")} />,
};

export const SignInCallbackFailed: Story = {
  name: "Sign in — callback failed",
  render: () => <AuthForm mode="signin" error={mapOAuthError("callback_failed")} />,
};

export const SignInCancelledAtProvider: Story = {
  name: "Sign in — cancelled at the provider",
  render: () => <AuthForm mode="signin" error={mapOAuthError("access_denied")} />,
};

export const SignUp: Story = {
  render: () => <AuthForm mode="signup" />,
};

export const InviteAccepted: Story = { render: () => <VerifiedScreen /> };

export const InviteExpired: Story = {
  render: () => <LinkExpiredScreen email="ada@northwind.example" />,
};

export const InviteAlreadyUsed: Story = {
  render: () => <LinkUsedScreen />,
};

export const AcceptInvite: Story = {
  render: () => (
    <AcceptInviteScreen
      workspace="Northwind Logistics"
      inviter="Grace Hopper"
      role="operator"
      email="ada@northwind.example"
    />
  ),
};

export const LockedOut: Story = { render: () => <LockedOutScreen /> };

export const OnboardingFlow: Story = {
  name: "Onboarding",
  render: () => <Onboarding />,
};
