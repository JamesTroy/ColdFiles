/**
 * Takedown request form — case-scoped.
 *
 * Entry from the case-detail "REPORT AN ISSUE WITH THIS CASE" link. Submits
 * to the takedown-submit Edge Function which returns a CF-XXXXX reference
 * code and emails both the operator and the submitter.
 *
 * Copy is locked per the watch-zone & takedown spec §11. The wording is the
 * product — don't paraphrase. "A real person" / "manually" / "5 business
 * days" are doing trust work; "the subject" is doing inclusion work.
 *
 * Form shape (§9):
 *   - Relationship       single-select dropdown (required)
 *   - Resolution         multi-select chips (≥1 required)
 *   - Reason             20–1000 char textarea (required)
 *   - Email              required, validated
 *   - Phone              optional
 *
 * Anonymous submission OK. The email is hashed before DB storage; the raw
 * value is used to send the confirmation reply, never persisted.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { Mono, MonoLabel, NarrativeText, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

type Relationship =
  | 'family'
  | 'subject'
  | 'legal'
  | 'journalist'
  | 'other';
type Resolution = 'remove_photo' | 'remove_case' | 'correct_info' | 'other';

const RELATIONSHIP_OPTIONS: { value: Relationship; label: string }[] = [
  { value: 'family', label: 'Family member of the subject' },
  { value: 'subject', label: 'I am the subject' },
  { value: 'legal', label: 'Legal representative' },
  { value: 'journalist', label: 'Journalist or researcher' },
  { value: 'other', label: 'Other' },
];

const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: 'remove_photo', label: 'Remove photo(s)' },
  { value: 'remove_case', label: 'Remove this case' },
  { value: 'correct_info', label: 'Correct information' },
  { value: 'other', label: 'Other' },
];

const REASON_MIN = 20;
const REASON_MAX = 1000;

interface CaseSummary {
  id: string;
  slug: string;
  title: string;
  metaLine: string;
}

export default function TakedownRequestScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : null;

  const [caseSummary, setCaseSummary] = useState<CaseSummary | null>(null);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [relationshipOther, setRelationshipOther] = useState('');
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ reference: string; email: string } | null>(null);

  useEffect(() => {
    if (!slug || !isSupabaseConfigured()) return;
    let cancelled = false;
    const supabase = getSupabase();
    supabase
      .from('cases')
      .select('id, slug, victim_name, kind, location_city, location_state, case_number_primary')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const r = data as {
          id: string;
          slug: string;
          victim_name: string | null;
          kind: string;
          location_city: string | null;
          location_state: string | null;
          case_number_primary: string | null;
        };
        const title = r.victim_name
          ?? (r.kind === 'unidentified' || r.kind === 'unclaimed' ? 'Unidentified person' : 'Name not released');
        const placeParts = [r.location_city, r.location_state].filter(Boolean).join(', ');
        const idPart = r.case_number_primary ? `${r.case_number_primary}` : r.slug.toUpperCase();
        const metaLine = [placeParts, idPart].filter(Boolean).join(' · ');
        setCaseSummary({ id: r.id, slug: r.slug, title, metaLine });
      });
    return () => { cancelled = true; };
  }, [slug]);

  const reasonOk = reason.trim().length >= REASON_MIN && reason.length <= REASON_MAX;
  const relationshipOk = relationship !== null
    && (relationship !== 'other' || relationshipOther.trim().length > 0);
  const canSubmit = !!caseSummary
    && relationshipOk
    && resolutions.length > 0
    && reasonOk
    && isValidEmail(email);

  const handleSubmit = async () => {
    if (!canSubmit || !caseSummary) return;
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'takedown-submit',
        {
          body: {
            case_id: caseSummary.id,
            relationship,
            relationship_other:
              relationship === 'other' ? relationshipOther.trim().slice(0, 50) : null,
            resolutions,
            reason: reason.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
          },
        },
      );
      if (fnError) throw new Error(fnError.message);
      const result = fnData as { reference?: string; error?: string } | null;
      if (!result?.reference) {
        throw new Error(result?.error ?? "Couldn't reach our servers. Your request hasn't been submitted yet — please try again.");
      }
      setSuccess({ reference: result.reference, email: email.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not submit request';
      Alert.alert("Couldn't submit", msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return <SuccessView reference={success.reference} email={success.email} insets={insets} />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tokens.color.bg.base }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <CloseButton onPress={() => maybeDismiss(reason || email || phone, () => router.back())} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <SerifTitle size="h1" style={{ fontSize: 30, lineHeight: 36 }}>
            Report an issue
          </SerifTitle>
          <NarrativeText
            style={{
              marginTop: 12,
              color: tokens.color.text.secondary,
              fontSize: tokens.size.body,
              lineHeight: tokens.size.body * 1.5,
            }}
          >
            We review every request manually. Most are answered within 5 business days.
          </NarrativeText>
        </View>

        {caseSummary ? (
          <>
            <Divider />
            <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
              <SectionLabel>ABOUT THIS CASE</SectionLabel>
              <SansMedium style={{ fontSize: 18 }}>{caseSummary.title}</SansMedium>
              <NarrativeText
                style={{
                  marginTop: 4,
                  color: tokens.color.text.secondary,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {caseSummary.metaLine}
              </NarrativeText>
            </View>
          </>
        ) : null}

        <Divider />

        <SectionLabel required>YOUR RELATIONSHIP TO THIS CASE</SectionLabel>
        <Dropdown
          options={RELATIONSHIP_OPTIONS}
          value={relationship}
          onChange={setRelationship}
        />
        {relationship === 'other' ? (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <TextInput
              value={relationshipOther}
              onChangeText={setRelationshipOther}
              placeholder="Specify (50 chars)"
              placeholderTextColor={tokens.color.text.disabled}
              maxLength={50}
              style={inputStyle()}
            />
          </View>
        ) : null}

        <SectionLabel required>WHAT WOULD YOU LIKE US TO DO?</SectionLabel>
        <View
          style={{
            paddingHorizontal: 16,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {RESOLUTION_OPTIONS.map((opt) => {
            const selected = resolutions.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setResolutions((prev) =>
                    prev.includes(opt.value)
                      ? prev.filter((v) => v !== opt.value)
                      : [...prev, opt.value],
                  );
                }}
                style={({ pressed }) => [
                  {
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    borderWidth: 0.5,
                    borderColor: selected
                      ? tokens.color.accent.amber
                      : tokens.color.border.hairline,
                    backgroundColor: selected
                      ? tokens.color.accent.amber
                      : tokens.color.bg.elev2,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <SansBody
                  style={{
                    color: selected ? tokens.color.bg.base : tokens.color.text.primary,
                    fontSize: 13,
                  }}
                >
                  {opt.label}
                </SansBody>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel required>TELL US MORE</SectionLabel>
        <View style={{ paddingHorizontal: 16 }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What would you like changed, and why?"
            placeholderTextColor={tokens.color.text.disabled}
            multiline
            numberOfLines={5}
            maxLength={REASON_MAX}
            textAlignVertical="top"
            style={[inputStyle(), { minHeight: 120 }]}
          />
          <Mono
            size={9}
            style={{
              color: reason.length >= REASON_MAX
                ? tokens.color.tip.success
                : reason.length >= REASON_MAX - 100
                  ? tokens.color.accent.amber
                  : tokens.color.text.disabled,
              alignSelf: 'flex-end',
              marginTop: 4,
            }}
          >
            {`${reason.length} / ${REASON_MAX}`}
          </Mono>
        </View>

        <SectionLabel required>YOUR EMAIL</SectionLabel>
        <View style={{ paddingHorizontal: 16 }}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={tokens.color.text.disabled}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            style={inputStyle()}
          />
          <NarrativeText
            style={{
              marginTop: 6,
              color: tokens.color.text.disabled,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            We&apos;ll only use this to follow up about this request.
          </NarrativeText>
        </View>

        <SectionLabel>PHONE (OPTIONAL)</SectionLabel>
        <View style={{ paddingHorizontal: 16 }}>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Optional"
            placeholderTextColor={tokens.color.text.disabled}
            keyboardType="phone-pad"
            autoComplete="tel"
            style={inputStyle()}
          />
        </View>

        <Divider top={28} />

        <NarrativeText
          style={{
            paddingHorizontal: 16,
            paddingTop: 16,
            color: tokens.color.text.secondary,
            fontSize: 13,
            lineHeight: 20,
          }}
        >
          By submitting, you agree to our review process. We don&apos;t share your contact information with anyone outside our team.
        </NarrativeText>

        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          <AmberCTA
            label={submitting ? 'Submitting…' : 'Submit request'}
            onPress={handleSubmit}
            loading={submitting}
          />
          {!canSubmit && !submitting ? (
            <MonoLabel
              size={9}
              tracking={tokens.tracking.label}
              color={tokens.color.text.disabled}
              style={{ alignSelf: 'center', marginTop: 8 }}
            >
              FILL REQUIRED FIELDS
            </MonoLabel>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SuccessView({
  reference,
  email,
  insets,
}: {
  reference: string;
  email: string;
  insets: { top: number; bottom: number };
}) {
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <CloseButton onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center' }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 1.5,
            borderColor: tokens.color.accent.amber,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Ionicons name="checkmark" size={28} color={tokens.color.accent.amber} />
        </View>
        <SerifTitle size="h1" style={{ fontSize: 30, lineHeight: 36 }}>
          Request received
        </SerifTitle>
        <NarrativeText
          style={{
            marginTop: 14,
            color: tokens.color.text.primary,
            fontSize: tokens.size.body,
            lineHeight: tokens.size.body * 1.55,
          }}
        >
          Thank you. A real person on our team will read your request and reply by email at {email}.
        </NarrativeText>
        <View style={{ marginTop: 18 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            tracking={tokens.tracking.label}
            color={tokens.color.text.secondary}
          >
            REFERENCE
          </MonoLabel>
          <Mono
            size={16}
            style={{
              marginTop: 4,
              color: tokens.color.text.primary,
              letterSpacing: 1,
            }}
          >
            {reference}
          </Mono>
        </View>
        <NarrativeText
          style={{
            marginTop: 22,
            color: tokens.color.text.secondary,
            fontSize: tokens.size.body,
            lineHeight: tokens.size.body * 1.55,
          }}
        >
          Most replies go out within 5 business days. If you don&apos;t hear back by then, reply to your confirmation email and we&apos;ll follow up.
        </NarrativeText>
      </View>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 28,
        }}
      >
        <AmberCTA label="Done" onPress={() => router.back()} />
      </View>
    </View>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Close"
      accessibilityRole="button"
      hitSlop={12}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="close" size={18} color={tokens.color.text.primary} />
    </Pressable>
  );
}

function Dropdown<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View
      style={{
        marginHorizontal: 16,
        backgroundColor: tokens.color.bg.elev1,
        borderColor: tokens.color.border.subtle,
        borderWidth: 0.5,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
                paddingVertical: 14,
                borderTopWidth: idx === 0 ? 0 : 0.5,
                borderTopColor: tokens.color.border.subtle,
                backgroundColor: selected ? tokens.color.bg.amberTintCard : 'transparent',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor: selected
                  ? tokens.color.accent.amber
                  : tokens.color.border.strong,
                marginRight: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {selected ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: tokens.color.accent.amber,
                  }}
                />
              ) : null}
            </View>
            <SansBody style={{ flex: 1, fontSize: 16 }}>{opt.label}</SansBody>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 22,
        paddingBottom: 8,
        gap: 4,
      }}
    >
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
      >
        {children}
      </MonoLabel>
      {required ? (
        <Mono size={tokens.size.monoChip} style={{ color: tokens.color.accent.amber }}>*</Mono>
      ) : null}
    </View>
  );
}

function Divider({ top = 18 }: { top?: number } = {}) {
  return (
    <View
      style={{
        marginTop: top,
        marginHorizontal: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
      }}
    />
  );
}

function inputStyle() {
  return {
    backgroundColor: tokens.color.bg.elev2,
    borderColor: tokens.color.border.hairline,
    borderWidth: 0.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: tokens.color.text.primary,
    fontFamily: tokens.font.sans,
    fontSize: 16,
  } as const;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;
}

function maybeDismiss(hasInput: string, onConfirm: () => void) {
  if (!hasInput || !hasInput.trim()) {
    onConfirm();
    return;
  }
  Alert.alert(
    'Discard request?',
    'Your draft will be lost.',
    [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onConfirm },
    ],
  );
}
