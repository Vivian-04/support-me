import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard — Top Creators & Supporters',
  description: 'See the top tipped creators and most generous supporters on SupportMe built on Stellar.',
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
