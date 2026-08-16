import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { AuthForm } from "./auth-form";
import {
  VerifyEmailScreen, VerifiedScreen, LinkExpiredScreen, LinkUsedScreen,
  ForgotPasswordScreen, ChoosePasswordScreen, AcceptInviteScreen, LockedOutScreen,
} from "./status-screens";
import { mapAuthError, mapOAuthError } from "./auth-errors";
import { Onboarding } from "~/components/app/onboarding/onboarding";

/**
 * Auth — every state, both themes.
 *
 * Sign-in is federated only: three OAuth providers and a SAML domain route.
 * There is no password on this screen, so the failure states are the ones the
 * provider round-trip can actually produce, driven through the REAL mappers
 * with the codes our routes emit.
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

export const SignInUnverified: Story = {
  name: "Sign in — email not verified",
  render: () => <AuthForm mode="signin" error={mapAuthError("Email not confirmed", 403, "")} />,
};

export const SignUp: Story = {
  render: () => <AuthForm mode="signup" />,
};

export const VerifyEmail: Story = {
  render: () => <VerifyEmailScreen email="ada@acme.com" />,
};

export const Verified: Story = { render: () => <VerifiedScreen /> };

export const LinkExpired: Story = {
  render: () => <LinkExpiredScreen kind="verification" email="ada@acme.com" />,
};

export const LinkAlreadyUsed: Story = {
  render: () => <LinkUsedScreen kind="reset" />,
};

export const ForgotPassword: Story = { render: () => <ForgotPasswordScreen /> };

export const ChoosePassword: Story = { render: () => <ChoosePasswordScreen /> };

export const AcceptInvite: Story = {
  render: () => (
    <AcceptInviteScreen
      workspace="Acme Platform"
      inviter="Grace Hopper"
      role="operator"
      email="ada@acme.com"
    />
  ),
};

export const LockedOut: Story = { render: () => <LockedOutScreen /> };

export const OnboardingFlow: Story = {
  name: "Onboarding",
  render: () => <Onboarding />,
};
