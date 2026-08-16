"use client";

import { useState } from "react";

import SignInForm from "./sign-in-form";
import SignUpForm from "./sign-up-form";

export default function AuthPanel() {
  const [showSignIn, setShowSignIn] = useState(true);

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
  );
}
