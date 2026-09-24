import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Eye, Info, Link2, ShieldCheck, Users, XCircle } from 'lucide-react';
import type { UserProfile } from '@suraksha/shared';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, InfoNote as InlineNotice, SectionHeader } from '@/components/StatusPieces';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDateTime, formatRelative } from '@/lib/format';
import { listContacts } from '@/services/contacts';
import { buildShareMessage, listShares, revokeShare } from '@/services/guardian';
import { listJourneys } from '@/services/journeys';
import { toast } from 'sonner';

/**
 * Guardian sharing overview (traveller side).
 *
 * Answers "who can currently see me, and what exactly can they see?" It is also
 * where access is revoked — instantly, including the server-side record.
 */
export function GuardianScreen({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'active' | 'past'>('active');

  const shares = useLiveQuery(() => listShares(user.id), [user.id], []);
  const journeys = useLiveQuery(() => listJourneys(user.id), [user.id], []);
  const contacts = useLiveQuery(() => listContacts(user.id), [user.id], []);

  const active = (shares ?? []).filter(
    (share) => share.status === 'active' && new Date(share.expiresAt).getTime() > Date.now(),
  );
  const inactive = (shares ?? []).filter(
    (share) => share.status === 'revoked' || new Date(share.expiresAt).getTime() <= Date.now(),
  );

  const journeyTitle = (journeyId: string) =>
    (journeys ?? []).find((journey) => journey.id === journeyId)?.title ?? 'Deleted journey';

  return (
    <div className="space-y-5 pb-4">
      <SectionHeader
        title="Guardian sharing"
        description="Encrypted, expiring, revocable access to your journeys."
      />

      <InlineNotice tone="info" title="How guardians receive your data">
        <ul className="list-inside list-disc space-y-1">
          <li>Each share gets its own AES-GCM key, delivered only in the link fragment.</li>
          <li>The server stores ciphertext and share metadata — never your raw location.</li>
          <li>Access expires automatically; revoking takes effect immediately.</li>
          <li>A guardian sees only the journeys you share, never your whole history.</li>
        </ul>
      </InlineNotice>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="past">Revoked & expired ({inactive.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {active.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No one can see your journeys right now"
              description="Open a journey and use “Share with a guardian” to grant time-limited access."
              action={
                <Button variant="accent" asChild>
                  <Link to="/app/journeys">Go to journeys</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {active.map((share) => (
                <li key={share.id} className="rounded-2xl border border-border bg-card/70 p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-400">
                      <Link2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{share.contactName}</p>
                      <p className="text-xs text-muted-foreground">{journeyTitle(share.journeyId)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {share.scopes.map((scope) => (
                          <Badge key={scope} variant="outline">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Created {formatRelative(share.createdAt)} · expires {formatDateTime(share.expiresAt)}
                        {share.lastViewedAt
                          ? ` · last opened ${formatRelative(share.lastViewedAt)}`
                          : ' · not opened yet'}
                      </p>
                    </div>
                    <Badge variant="success">
                      <ShieldCheck className="size-3" />
                      Active
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const message = buildShareMessage(
                          share,
                          journeys?.find((journey) => journey.id === share.journeyId),
                          `${window.location.origin}/g/${share.token}#k=<key in the original link>`,
                        );
                        if (navigator.share) {
                          try {
                            await navigator.share({ title: 'SURAKSHA guardian link', text: message });
                            return;
                          } catch {
                            /* fall through */
                          }
                        }
                        try {
                          await navigator.clipboard.writeText(message);
                          toast.success('Guardian link copied.');
                        } catch {
                          toast.error('Could not copy the link — open the journey to see it.');
                        }
                      }}
                    >
                      <Copy className="size-4" />
                      Copy link
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/app/journeys/${share.journeyId}`}>
                        <Eye className="size-4" />
                        View journey
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 dark:text-red-400"
                      onClick={async () => {
                        await revokeShare(share.id);
                        toast.success(`${share.contactName} can no longer see this journey.`);
                      }}
                    >
                      <XCircle className="size-4" />
                      Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="past">
          {inactive.length === 0 ? (
            <EmptyState
              icon={<Info className="size-5" />}
              title="Nothing revoked or expired"
              description="When a share expires or you revoke it, it moves here for your records."
            />
          ) : (
            <ul className="space-y-2">
              {inactive.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3.5"
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{share.contactName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {journeyTitle(share.journeyId)} ·{' '}
                      {share.status === 'revoked' ? 'revoked by you' : 'expired'} ·{' '}
                      {formatDateTime(share.expiresAt)}
                    </p>
                  </div>
                  <Badge variant="muted">{share.status === 'revoked' ? 'Revoked' : 'Expired'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Who is eligible to be a guardian</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {(contacts ?? []).filter((contact) => contact.canViewJourney).length === 0 ? (
            <p className="text-muted-foreground">
              No contact currently has guardian access enabled. Turn it on in Settings ▸ Trusted
              contacts.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(contacts ?? [])
                .filter((contact) => contact.canViewJourney)
                .map((contact) => (
                  <li key={contact.id} className="flex items-center justify-between gap-2">
                    <span>
                      {contact.name} <span className="text-muted-foreground">· {contact.relationship}</span>
                    </span>
                    <Badge variant="outline">guardian enabled</Badge>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/50 px-3 py-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-teal-500" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{DISCLAIMERS.shareDisclaimer}</p>
      </div>
    </div>
  );
}

export default GuardianScreen;
