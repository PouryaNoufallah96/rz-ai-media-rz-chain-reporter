"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rz-chain-reporter/ui/components/dropdown-menu";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { useAction } from "@/hooks/use-action";
import { Link, useRouter } from "@/i18n/navigation";
import { signOutAction } from "../actions/auth-actions";
import { authClient } from "../lib/auth-client";

type SessionUser = (typeof authClient.$Infer.Session)["user"];

export type UserMenuUser = Pick<SessionUser, "id" | "name" | "email">;

export default function UserMenu({ user }: { user: UserMenuUser | null }) {
  const router = useRouter();
  const signOut = useAction(signOutAction, {
    onSuccess: () => {
      authClient.$store.notify("$sessionSignal");
      router.push("/");
    },
  });
  const t = useTranslations(SHARED_NAMESPACE);
  const {
    data: session,
    error,
    isPending,
    isRefetching,
  } = authClient.useSession();
  const refreshedDivergence = useRef<string | null>(null);
  const clientUserId = session?.user.id ?? null;
  const serverUserId = user?.id ?? null;

  useEffect(() => {
    if (isPending || isRefetching || error) return;

    if (clientUserId === serverUserId) {
      refreshedDivergence.current = null;
      return;
    }

    const divergence = JSON.stringify([serverUserId, clientUserId]);
    if (refreshedDivergence.current === divergence) return;

    refreshedDivergence.current = divergence;
    router.refresh();
  }, [clientUserId, error, isPending, isRefetching, router, serverUserId]);

  if (!user) {
    return (
      <Button
        className="max-sm:min-h-11"
        nativeButton={false}
        render={<Link href="/login" />}
        variant="default"
      >
        {t("userMenu.signIn")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="min-w-0 max-w-48 max-sm:min-h-11"
            suppressHydrationWarning
            variant="ghost"
          />
        }
      >
        <span className="sm:hidden">{t("userMenu.account")}</span>
        <span className="hidden min-w-0 truncate sm:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[calc(100vw-1rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("userMenu.account")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="wrap-break-word whitespace-normal text-foreground">
            {user.name}
          </DropdownMenuLabel>
          <DropdownMenuLabel className="whitespace-normal break-all font-normal">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={signOut.isPending}
            variant="destructive"
            onClick={() => {
              void signOut.execute();
            }}
          >
            {t("userMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
