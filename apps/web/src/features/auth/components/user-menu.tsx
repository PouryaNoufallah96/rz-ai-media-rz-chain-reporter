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
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link, useRouter } from "@/i18n/navigation";
import { signOutAction } from "../actions/auth-actions";
import { authClient } from "../lib/auth-client";

export default function UserMenu() {
  const router = useRouter();
  const t = useTranslations(SHARED_NAMESPACE);
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Button
        nativeButton={false}
        render={<Link href="/login" />}
        variant="outline"
      >
        {t("userMenu.signIn")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("userMenu.account")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="font-normal">
            {session.user.email}
          </DropdownMenuLabel>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              const [error] = await signOutAction();
              if (error) return;
              // Cookie is cleared server-side; the client atom only refetches on this signal.
              authClient.$store.notify("$sessionSignal");
              router.push("/");
            }}
          >
            {t("userMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
