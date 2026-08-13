import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { AuthForm } from "./auth-form";
import {
  VerifyEmailScreen, VerifiedScreen, LinkExpiredScreen, LinkUsedScreen,
  ForgotPasswordScreen, ChoosePasswordScreen, AcceptInviteScreen, LockedOutScreen,
} from "./status-screens";
import { mapAuthError } from "./auth-errors";
import { Onboarding } from "~/components/app/onboarding/onboarding";

/**
 * Auth — every state, both themes.
 *
 * The error states are produced by the REAL mapper, driven with the API
 * responses that cause them, so what you see here is what a user gets rather
 * than a hand-written approximation.
 */

const meta = { title: "Flows/Auth", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const SignIn: Story = {
  render: () => <AuthForm mode="signin" onSubmit={noop} />,
};

export const SignInLoading: Story = {
  name: "Sign in — submitting",
  render: () => <AuthForm mode="signin" loading onSubmit={noop} initialEmail="ada@acme.com" />,
};

export const SignInWrongPassword: Story = {
  name: "Sign in — wrong password",
  render: () => (
    <AuthForm
      mode="signin"
      onSubmit={noop}
      initialEmail="ada@acme.com"
      error={mapAuthError("Invalid credentials", 401, "ada@acme.com")}
    />
  ),
};

export const SignInNoAccount: Story = {
  name: "Sign in — no account",
  render: () => (
    <AuthForm
      mode="signin"
      onSubmit={noop}
      initialEmail="nobody@acme.com"
      error={mapAuthError("No user found", 404, "nobody@acme.com")}
    />
  ),
};

export const SignInLocked: Story = {
  name: "Sign in — account locked",
  render: () => (
    <AuthForm
      mode="signin"
      onSubmit={noop}
      initialEmail="ada@acme.com"
      error={mapAuthError("Account locked", 423, "ada@acme.com")}
    />
  ),
};

export const SignInRateLimited: Story = {
  name: "Sign in — rate limited",
  render: () => (
    <AuthForm
      mode="signin"
      onSubmit={noop}
      initialEmail="ada@acme.com"
      error={mapAuthError("Too many requests", 429, "ada@acme.com")}
    />
  ),
};

export const SignInUnverified: Story = {
  name: "Sign in — email not verified",
  render: () => (
    <AuthForm
      mode="signin"
      onSubmit={noop}
      initialEmail="ada@acme.com"
      error={mapAuthError("Email not confirmed", 403, "ada@acme.com")}
    />
  ),
};

export const SignInSamlDomain: Story = {
  name: "Sign in — SAML domain routed",
  render: () => <AuthForm mode="signin" onSubmit={noop} initialEmail="dana@acme-corp.com" />,
};

export const SignUp: Story = {
  render: () => <AuthForm mode="signup" onSubmit={noop} />,
};

export const SignUpConsumerEmail: Story = {
  name: "Sign up — consumer email",
  render: () => <AuthForm mode="signup" onSubmit={noop} initialEmail="ada@gmail.com" />,
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
