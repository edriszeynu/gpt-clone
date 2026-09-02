"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const token = useChatStore((s) => s.token);

  useEffect(() => {
    router.replace(token ? "/chat" : "/login");
  }, [token, router]);

  return null;
}
