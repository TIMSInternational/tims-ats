-- TIMS ATS — production schema baseline (issue #115)
--
-- Captured:        2026-08-03T18:13:55Z
-- Server version:  17.6
-- Schemas:         public, supabase_migrations
-- Command:         bash scripts/db/schema-baseline.sh capture
--
-- This file is GROUND TRUTH for what production actually looks like — not what the
-- migrations say it should look like. #111 proved those are different things.
-- Regenerate with 'capture' and review the git diff; 'check' fails CI on divergence.
-- >>> END BASELINE HEADER — everything below is verbatim pg_dump output
--
-- PostgreSQL database dump
--

\restrict <nonce-normalised>

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA public;

ALTER SCHEMA public OWNER TO postgres;

--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA supabase_migrations;

ALTER SCHEMA supabase_migrations OWNER TO postgres;

--
-- Name: AiAnalysisStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AiAnalysisStatus" AS ENUM (
    'pending',
    'completed',
    'failed'
);

ALTER TYPE public."AiAnalysisStatus" OWNER TO postgres;

--
-- Name: AiInterviewStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AiInterviewStatus" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed',
    'expired'
);

ALTER TYPE public."AiInterviewStatus" OWNER TO postgres;

--
-- Name: DisabilityStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."DisabilityStatus" AS ENUM (
    'none',
    'has_disability',
    'undisclosed'
);

ALTER TYPE public."DisabilityStatus" OWNER TO postgres;

--
-- Name: Ethnicity; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Ethnicity" AS ENUM (
    'mestizo',
    'afrodescendiente',
    'indigena',
    'raizal',
    'rom',
    'palenquero',
    'blanco',
    'otro',
    'undisclosed'
);

ALTER TYPE public."Ethnicity" OWNER TO postgres;

--
-- Name: Gender; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Gender" AS ENUM (
    'female',
    'male',
    'non_binary',
    'undisclosed'
);

ALTER TYPE public."Gender" OWNER TO postgres;

--
-- Name: HirePredictionStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."HirePredictionStatus" AS ENUM (
    'scored',
    'partial',
    'none'
);

ALTER TYPE public."HirePredictionStatus" OWNER TO postgres;

--
-- Name: InvitationStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvitationStatus" AS ENUM (
    'pending',
    'sent',
    'accepted',
    'expired',
    'revoked'
);

ALTER TYPE public."InvitationStatus" OWNER TO postgres;

--
-- Name: InvitationType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvitationType" AS ENUM (
    'org_admin',
    'user'
);

ALTER TYPE public."InvitationType" OWNER TO postgres;

--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'draft',
    'pending',
    'paid',
    'void'
);

ALTER TYPE public."InvoiceStatus" OWNER TO postgres;

--
-- Name: OrgPlan; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."OrgPlan" AS ENUM (
    'trial',
    'starter',
    'professional',
    'enterprise'
);

ALTER TYPE public."OrgPlan" OWNER TO postgres;

--
-- Name: QuestionType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."QuestionType" AS ENUM (
    'single_choice',
    'multi_choice',
    'free_text'
);

ALTER TYPE public."QuestionType" OWNER TO postgres;

--
-- Name: RaterAssignmentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."RaterAssignmentStatus" AS ENUM (
    'pending',
    'submitted'
);

ALTER TYPE public."RaterAssignmentStatus" OWNER TO postgres;

--
-- Name: RaterRelationship; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."RaterRelationship" AS ENUM (
    'self',
    'manager',
    'peer',
    'direct_report'
);

ALTER TYPE public."RaterRelationship" OWNER TO postgres;

--
-- Name: ReviewCycleStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ReviewCycleStatus" AS ENUM (
    'draft',
    'open',
    'closed',
    'published'
);

ALTER TYPE public."ReviewCycleStatus" OWNER TO postgres;

--
-- Name: ScoreBand; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ScoreBand" AS ENUM (
    'below_average',
    'average',
    'above_average',
    'excellent'
);

ALTER TYPE public."ScoreBand" OWNER TO postgres;

--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'trialing',
    'active',
    'past_due',
    'cancelled'
);

ALTER TYPE public."SubscriptionStatus" OWNER TO postgres;

--
-- Name: current_org_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$$;

ALTER FUNCTION public.current_org_id() OWNER TO postgres;

--
-- Name: tims_append_only_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tims_append_only_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

ALTER FUNCTION public.tims_append_only_guard() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);

ALTER TABLE public."__EFMigrationsHistory" OWNER TO postgres;

--
-- Name: access_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.access_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    reviewed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_count integer NOT NULL,
    privileged_count integer NOT NULL,
    stale_count integer NOT NULL,
    deprovision_gap_count integer NOT NULL,
    expired_gap_count integer NOT NULL,
    notes character varying(2000),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.access_reviews FORCE ROW LEVEL SECURITY;

ALTER TABLE public.access_reviews OWNER TO postgres;

--
-- Name: action_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.action_plans (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    responsible_id uuid NOT NULL,
    area text,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date timestamp(3) without time zone,
    actions jsonb,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.action_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.action_plans OWNER TO postgres;

--
-- Name: ai_agent_org_configs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_agent_org_configs (
    id uuid NOT NULL,
    agent_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    monthly_budget double precision,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    addon_monthly_fee_usd double precision,
    billable_usd_per_minute double precision,
    ai_interview_default_max_minutes integer,
    ai_interview_max_minutes_by_type jsonb
);

ALTER TABLE ONLY public.ai_agent_org_configs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_agent_org_configs OWNER TO postgres;

--
-- Name: ai_agent_usage_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_agent_usage_logs (
    id uuid NOT NULL,
    agent_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_usd double precision DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    cached boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    billable_usd double precision DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.ai_agent_usage_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_agent_usage_logs OWNER TO postgres;

--
-- Name: ai_agents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_agents (
    id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    model text DEFAULT 'haiku'::text NOT NULL,
    batch_eligible boolean DEFAULT false NOT NULL,
    cache_ttl_seconds integer DEFAULT 0 NOT NULL,
    cost_per_call double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'stub'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE public.ai_agents OWNER TO postgres;

--
-- Name: ai_interview_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_interview_sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    interview_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    status public."AiInterviewStatus" DEFAULT 'pending'::public."AiInterviewStatus" NOT NULL,
    elevenlabs_agent_id text,
    elevenlabs_conversation_id text,
    guide_questions jsonb NOT NULL,
    transcript jsonb,
    audio_url text,
    duration_seconds integer,
    consented_at timestamp(3) without time zone,
    consent_text_version text,
    analysis_status public."AiAnalysisStatus" DEFAULT 'pending'::public."AiAnalysisStatus" NOT NULL,
    summary jsonb,
    bias_report jsonb,
    fit_score integer,
    analysis_model text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    candidate_token text NOT NULL,
    max_duration_seconds integer
);

ALTER TABLE ONLY public.ai_interview_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_interview_sessions OWNER TO postgres;

--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alert_rules (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    module text NOT NULL,
    condition jsonb NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.alert_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.alert_rules OWNER TO postgres;

--
-- Name: alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alerts (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    rule_id uuid,
    module text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    metadata jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    dismissed_by_id uuid,
    dismissed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.alerts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.alerts OWNER TO postgres;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.api_keys (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    environment text DEFAULT 'production'::text NOT NULL,
    scopes jsonb NOT NULL,
    last_used_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    revoked_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.api_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE public.api_keys OWNER TO postgres;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.applications (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    current_stage_id uuid NOT NULL,
    source text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    applied_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    rejected_at timestamp(3) without time zone,
    rejected_reason text,
    feedback text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    cover_letter text,
    referral_token text,
    checklist_progress jsonb
);

ALTER TABLE ONLY public.applications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.applications OWNER TO postgres;

--
-- Name: assessment_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_assignments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    assessment_type_id uuid NOT NULL,
    status text NOT NULL,
    assigned_by_id uuid NOT NULL,
    assigned_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    started_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone,
    reminder_sent_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.assessment_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_assignments OWNER TO postgres;

--
-- Name: assessment_consents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_consents (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    consent_type text NOT NULL,
    text_version text NOT NULL,
    agreed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.assessment_consents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_consents OWNER TO postgres;

--
-- Name: assessment_questions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_questions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    assessment_type_id uuid NOT NULL,
    "order" integer NOT NULL,
    type public."QuestionType" NOT NULL,
    prompt text NOT NULL,
    options jsonb NOT NULL,
    correct_option_ids jsonb NOT NULL,
    points integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.assessment_questions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_questions OWNER TO postgres;

--
-- Name: assessment_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_responses (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    question_id uuid NOT NULL,
    selected_option_ids jsonb,
    free_text text,
    is_correct boolean,
    points_awarded double precision,
    submitted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.assessment_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_responses OWNER TO postgres;

--
-- Name: assessment_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_results (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    raw_score double precision,
    normalized_score double precision,
    percentile double precision,
    breakdown jsonb,
    interpretation jsonb,
    model_version text,
    scored_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    band public."ScoreBand",
    norm_sample_size integer
);

ALTER TABLE ONLY public.assessment_results FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_results OWNER TO postgres;

--
-- Name: assessment_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_types (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    duration integer,
    is_active boolean DEFAULT true NOT NULL,
    config jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.assessment_types FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_types OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    actor_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    changes jsonb,
    metadata jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: benefit_enrollments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.benefit_enrollments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    benefit_plan_id uuid NOT NULL,
    enrolled_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'active'::text NOT NULL
);

ALTER TABLE ONLY public.benefit_enrollments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.benefit_enrollments OWNER TO postgres;

--
-- Name: benefit_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.benefit_plans (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.benefit_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.benefit_plans OWNER TO postgres;

--
-- Name: billing_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.billing_profiles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_name text,
    tax_id text,
    address text,
    city text,
    state text,
    country text,
    zip_code text,
    billing_email text,
    billing_phone text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.billing_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.billing_profiles OWNER TO postgres;

--
-- Name: business_units; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.business_units (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    code text,
    parent_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.business_units FORCE ROW LEVEL SECURITY;

ALTER TABLE public.business_units OWNER TO postgres;

--
-- Name: calibration_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calibration_members (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.calibration_members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.calibration_members OWNER TO postgres;

--
-- Name: calibration_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calibration_sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    period text NOT NULL,
    status text NOT NULL,
    scheduled_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.calibration_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.calibration_sessions OWNER TO postgres;

--
-- Name: calibration_votes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calibration_votes (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    evaluated_user_id uuid NOT NULL,
    voter_id uuid NOT NULL,
    quadrant text NOT NULL,
    justification text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.calibration_votes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.calibration_votes OWNER TO postgres;

--
-- Name: candidate_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.candidate_documents (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    type text NOT NULL,
    file_name text NOT NULL,
    file_url text NOT NULL,
    file_size integer,
    parsed_data jsonb,
    uploaded_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.candidate_documents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.candidate_documents OWNER TO postgres;

--
-- Name: candidate_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.candidate_tags (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    tag text NOT NULL,
    source text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.candidate_tags FORCE ROW LEVEL SECURITY;

ALTER TABLE public.candidate_tags OWNER TO postgres;

--
-- Name: candidates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.candidates (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    source text NOT NULL,
    pool_type text NOT NULL,
    avatar text,
    location text,
    current_title text,
    current_company text,
    years_experience integer,
    skills jsonb,
    linkedin_url text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone,
    education jsonb,
    languages jsonb
);

ALTER TABLE ONLY public.candidates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.candidates OWNER TO postgres;

--
-- Name: certificates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.certificates (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    enrollment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    issued_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    certificate_url text
);

ALTER TABLE ONLY public.certificates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.certificates OWNER TO postgres;

--
-- Name: coaching_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coaching_sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    leader_id uuid NOT NULL,
    scheduled_at timestamp(3) without time zone NOT NULL,
    duration integer,
    topic text NOT NULL,
    type text DEFAULT 'scheduled'::text NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.coaching_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.coaching_sessions OWNER TO postgres;

--
-- Name: commitments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.commitments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    coaching_session_id uuid,
    description text NOT NULL,
    due_date timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.commitments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.commitments OWNER TO postgres;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.companies (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    country text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    timezone text DEFAULT 'America/Bogota'::text NOT NULL,
    language text DEFAULT 'es'::text NOT NULL,
    legal_name text,
    tax_id text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.companies FORCE ROW LEVEL SECURITY;

ALTER TABLE public.companies OWNER TO postgres;

--
-- Name: connector_syncs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_syncs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    status text NOT NULL,
    entities_processed integer DEFAULT 0 NOT NULL,
    duration integer,
    error text,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.connector_syncs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.connector_syncs OWNER TO postgres;

--
-- Name: connectors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connectors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    config jsonb NOT NULL,
    last_sync_at timestamp(3) without time zone,
    sync_frequency text,
    entities_synced integer DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.connectors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.connectors OWNER TO postgres;

--
-- Name: courses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.courses (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    type text NOT NULL,
    category text,
    duration integer NOT NULL,
    content jsonb,
    is_required boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.courses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.courses OWNER TO postgres;

--
-- Name: critical_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.critical_roles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    position_id text,
    current_holder_id uuid,
    company_id uuid,
    unit_id uuid,
    criticality text NOT NULL,
    flight_risk double precision,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    target_band_level text
);

ALTER TABLE ONLY public.critical_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.critical_roles OWNER TO postgres;

--
-- Name: data_access_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.data_access_logs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    data_type text NOT NULL,
    record_id uuid NOT NULL,
    action text NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.data_access_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.data_access_logs OWNER TO postgres;

--
-- Name: data_consents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.data_consents (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    subject_user_id uuid NOT NULL,
    consent_type text NOT NULL,
    text_version text NOT NULL,
    agreed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    withdrawn_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.data_consents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.data_consents OWNER TO postgres;

--
-- Name: employee_compensations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_compensations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    current_salary double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    compa_ratio double precision,
    band_id uuid,
    variable_pay double precision,
    effective_date timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.employee_compensations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.employee_compensations OWNER TO postgres;

--
-- Name: employee_demographics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_demographics (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    gender public."Gender" DEFAULT 'undisclosed'::public."Gender" NOT NULL,
    date_of_birth date,
    nationality text,
    ethnicity public."Ethnicity" DEFAULT 'undisclosed'::public."Ethnicity" NOT NULL,
    disability_status public."DisabilityStatus" DEFAULT 'undisclosed'::public."DisabilityStatus" NOT NULL,
    self_identified boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.employee_demographics FORCE ROW LEVEL SECURITY;

ALTER TABLE public.employee_demographics OWNER TO postgres;

--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.enrollments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    status text NOT NULL,
    progress double precision DEFAULT 0 NOT NULL,
    pre_test_score double precision,
    post_test_score double precision,
    enrolled_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.enrollments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.enrollments OWNER TO postgres;

--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.feature_flags (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    key text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    payload jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.feature_flags FORCE ROW LEVEL SECURITY;

ALTER TABLE public.feature_flags OWNER TO postgres;

--
-- Name: feedbacks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.feedbacks (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    is_anonymous boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.feedbacks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.feedbacks OWNER TO postgres;

--
-- Name: fit_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fit_scores (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    overall_score double precision NOT NULL,
    breakdown jsonb NOT NULL,
    weights jsonb NOT NULL,
    is_partial boolean DEFAULT false NOT NULL,
    calculated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.fit_scores FORCE ROW LEVEL SECURITY;

ALTER TABLE public.fit_scores OWNER TO postgres;

--
-- Name: fx_rates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fx_rates (
    id uuid NOT NULL,
    base_currency text NOT NULL,
    quote_currency text NOT NULL,
    rate double precision NOT NULL,
    as_of date NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    source text NOT NULL
);

ALTER TABLE public.fx_rates OWNER TO postgres;

--
-- Name: hire_predictions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hire_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    application_id uuid,
    overall_score double precision,
    breakdown jsonb,
    weights jsonb,
    is_partial boolean,
    fit_calculated_at timestamp(3) without time zone,
    prediction_status public."HirePredictionStatus" NOT NULL,
    hired_by_id uuid,
    captured_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.hire_predictions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.hire_predictions OWNER TO postgres;

--
-- Name: hris_connectors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hris_connectors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    provider text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL,
    secret_ref text,
    subdomain text,
    field_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    sync_cursor text,
    sync_cadence text,
    last_sync_run_id uuid,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hris_connectors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.hris_connectors OWNER TO postgres;

--
-- Name: hris_external_employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hris_external_employees (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    external_id text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    work_email text,
    job_title text,
    department text,
    division text,
    hire_date date,
    employment_status text,
    supervisor_external_id text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_hash text NOT NULL,
    is_deleted_in_source boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hris_external_employees FORCE ROW LEVEL SECURITY;

ALTER TABLE public.hris_external_employees OWNER TO postgres;

--
-- Name: hris_sync_record_errors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hris_sync_record_errors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sync_run_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    external_id text,
    error_type text NOT NULL,
    message text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hris_sync_record_errors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.hris_sync_record_errors OWNER TO postgres;

--
-- Name: hris_sync_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hris_sync_runs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    status text NOT NULL,
    trigger text NOT NULL,
    idempotency_key text NOT NULL,
    cursor_before text,
    cursor_after text,
    records_seen integer DEFAULT 0 NOT NULL,
    records_upserted integer DEFAULT 0 NOT NULL,
    records_failed integer DEFAULT 0 NOT NULL,
    error_summary text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hris_sync_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.hris_sync_runs OWNER TO postgres;

--
-- Name: interview_evaluators; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.interview_evaluators (
    id uuid NOT NULL,
    interview_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.interview_evaluators FORCE ROW LEVEL SECURITY;

ALTER TABLE public.interview_evaluators OWNER TO postgres;

--
-- Name: interview_scorecards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.interview_scorecards (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    interview_id uuid NOT NULL,
    evaluator_id uuid NOT NULL,
    ratings jsonb NOT NULL,
    recommendation text NOT NULL,
    overall_notes text,
    bias_flags jsonb,
    submitted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.interview_scorecards FORCE ROW LEVEL SECURITY;

ALTER TABLE public.interview_scorecards OWNER TO postgres;

--
-- Name: interview_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.interview_summaries (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    interview_id uuid NOT NULL,
    summary text NOT NULL,
    key_points jsonb NOT NULL,
    strengths jsonb NOT NULL,
    concerns jsonb NOT NULL,
    generated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    model text
);

ALTER TABLE ONLY public.interview_summaries FORCE ROW LEVEL SECURITY;

ALTER TABLE public.interview_summaries OWNER TO postgres;

--
-- Name: interviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.interviews (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    application_id uuid,
    type text NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    scheduled_at timestamp(3) without time zone NOT NULL,
    duration integer NOT NULL,
    location text,
    meeting_url text,
    recording_url text,
    transcript_url text,
    notes text,
    cancelled_at timestamp(3) without time zone,
    cancel_reason text,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.interviews FORCE ROW LEVEL SECURITY;

ALTER TABLE public.interviews OWNER TO postgres;

--
-- Name: invoice_line_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_line_items (
    id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price double precision NOT NULL,
    total double precision NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.invoice_line_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoice_line_items OWNER TO postgres;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id uuid NOT NULL,
    invoice_number integer NOT NULL,
    organization_id uuid NOT NULL,
    subscription_id uuid,
    stripe_invoice_id text,
    amount double precision NOT NULL,
    subtotal double precision,
    tax_rate double precision,
    currency text DEFAULT 'USD'::text NOT NULL,
    status public."InvoiceStatus" DEFAULT 'draft'::public."InvoiceStatus" NOT NULL,
    description text,
    invoice_date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    due_date timestamp(3) without time zone,
    po_number text,
    notes text,
    memo text,
    email_to text,
    email_cc text,
    paid_at timestamp(3) without time zone,
    invoice_url text,
    period_start timestamp(3) without time zone,
    period_end timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: invoices_invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoices_invoice_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.invoices_invoice_number_seq OWNER TO postgres;

--
-- Name: invoices_invoice_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoices_invoice_number_seq OWNED BY public.invoices.invoice_number;

--
-- Name: job_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_profiles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    disc_targets jsonb DEFAULT '{}'::jsonb NOT NULL,
    competencies jsonb DEFAULT '{}'::jsonb NOT NULL,
    pca_expected jsonb,
    mil_expected jsonb,
    kpis jsonb,
    requirements jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    fit_requirements jsonb
);

ALTER TABLE ONLY public.job_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_profiles OWNER TO postgres;

--
-- Name: key_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.key_results (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    okr_id uuid NOT NULL,
    title text NOT NULL,
    target_value double precision NOT NULL,
    current_value double precision DEFAULT 0 NOT NULL,
    unit text,
    status text DEFAULT 'on_track'::text NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.key_results FORCE ROW LEVEL SECURITY;

ALTER TABLE public.key_results OWNER TO postgres;

--
-- Name: leader_commitments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leader_commitments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    leader_id uuid NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.leader_commitments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.leader_commitments OWNER TO postgres;

--
-- Name: learning_path_courses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_path_courses (
    id uuid NOT NULL,
    path_id uuid NOT NULL,
    course_id uuid NOT NULL,
    "order" integer NOT NULL
);

ALTER TABLE ONLY public.learning_path_courses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.learning_path_courses OWNER TO postgres;

--
-- Name: learning_paths; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_paths (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    target_gap text,
    is_auto_generated boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.learning_paths FORCE ROW LEVEL SECURITY;

ALTER TABLE public.learning_paths OWNER TO postgres;

--
-- Name: legal_checks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.legal_checks (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    country text NOT NULL,
    check_name text NOT NULL,
    description text,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp(3) without time zone,
    completed_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.legal_checks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.legal_checks OWNER TO postgres;

--
-- Name: modules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.modules (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    kind text NOT NULL,
    metered boolean DEFAULT false NOT NULL,
    unit text,
    default_unit_price double precision,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE public.modules OWNER TO postgres;

--
-- Name: nine_box_evaluations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.nine_box_evaluations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    period text NOT NULL,
    potential_score double precision NOT NULL,
    performance_score double precision NOT NULL,
    quadrant text NOT NULL,
    confidence double precision NOT NULL,
    axis_breakdown jsonb NOT NULL,
    evaluated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.nine_box_evaluations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.nine_box_evaluations OWNER TO postgres;

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_preferences (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    categories jsonb DEFAULT '{"info": true, "success": true, "warning": true, "critical": true}'::jsonb NOT NULL,
    modules jsonb DEFAULT '{}'::jsonb NOT NULL,
    quiet_hours_start text,
    quiet_hours_end text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.notification_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_preferences OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    organization_id uuid,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text,
    module text,
    entity_type text,
    entity_id uuid,
    action_url text,
    read boolean DEFAULT false NOT NULL,
    read_at timestamp(3) without time zone,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: offer_approvals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offer_approvals (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    approver_id uuid NOT NULL,
    step integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    comment text,
    decided_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.offer_approvals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.offer_approvals OWNER TO postgres;

--
-- Name: offers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offers (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    application_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    salary double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    start_date timestamp(3) without time zone NOT NULL,
    contract_type text NOT NULL,
    benefits jsonb,
    terms jsonb,
    signed_document_url text,
    sent_at timestamp(3) without time zone,
    responded_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.offers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.offers OWNER TO postgres;

--
-- Name: okrs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.okrs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid,
    title text NOT NULL,
    period text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    progress double precision DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.okrs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.okrs OWNER TO postgres;

--
-- Name: onboarding_check_ins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.onboarding_check_ins (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    type text NOT NULL,
    scheduled_date timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    score integer,
    completed_at timestamp(3) without time zone,
    completed_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.onboarding_check_ins FORCE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_check_ins OWNER TO postgres;

--
-- Name: onboarding_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.onboarding_plans (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    buddy_id uuid,
    start_date timestamp(3) without time zone NOT NULL,
    phase text DEFAULT 'day1_30'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    risk_score double precision,
    completed_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.onboarding_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_plans OWNER TO postgres;

--
-- Name: onboarding_tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.onboarding_tasks (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    responsible text NOT NULL,
    phase text NOT NULL,
    due_date timestamp(3) without time zone,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp(3) without time zone,
    completed_by_id uuid,
    "order" integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.onboarding_tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_tasks OWNER TO postgres;

--
-- Name: org_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.org_entitlements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    module_code text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    source text NOT NULL,
    "limit" integer,
    unit_price double precision,
    activated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.org_entitlements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.org_entitlements OWNER TO postgres;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    domain text,
    logo text,
    plan public."OrgPlan" DEFAULT 'trial'::public."OrgPlan" NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    billing_email text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organizations OWNER TO postgres;

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permissions (
    id uuid NOT NULL,
    module text NOT NULL,
    action text NOT NULL,
    description text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.permissions OWNER TO postgres;

--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pipeline_stages (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    name text NOT NULL,
    "order" integer NOT NULL,
    sla_hours integer,
    checklist jsonb,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.pipeline_stages FORCE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_stages OWNER TO postgres;

--
-- Name: plan_modules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plan_modules (
    id uuid NOT NULL,
    plan_code text NOT NULL,
    module_code text NOT NULL,
    "limit" integer
);

ALTER TABLE public.plan_modules OWNER TO postgres;

--
-- Name: plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plans (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE public.plans OWNER TO postgres;

--
-- Name: platform_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_invitations (
    id uuid NOT NULL,
    email text NOT NULL,
    type public."InvitationType" NOT NULL,
    organization_id uuid,
    organization_name text,
    organization_slug text,
    organization_plan text,
    role_slug text,
    token text NOT NULL,
    status public."InvitationStatus" DEFAULT 'pending'::public."InvitationStatus" NOT NULL,
    invited_by_id uuid NOT NULL,
    sent_at timestamp(3) without time zone,
    accepted_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.platform_invitations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.platform_invitations OWNER TO postgres;

--
-- Name: platform_owner_emails; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_owner_emails (
    id uuid NOT NULL,
    email text NOT NULL,
    added_by text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.platform_owner_emails OWNER TO postgres;

--
-- Name: preemployment_validations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.preemployment_validations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    is_blocking boolean DEFAULT true NOT NULL,
    result jsonb,
    completed_by_id uuid,
    completed_at timestamp(3) without time zone,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    completed_by_api_key_id uuid,
    CONSTRAINT preemployment_validations_single_completer_chk CHECK (((completed_by_id IS NULL) OR (completed_by_api_key_id IS NULL)))
);

ALTER TABLE ONLY public.preemployment_validations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.preemployment_validations OWNER TO postgres;

--
-- Name: proctoring_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.proctoring_sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    started_at timestamp(3) without time zone NOT NULL,
    ended_at timestamp(3) without time zone,
    flag_count integer DEFAULT 0 NOT NULL,
    severity text,
    events jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.proctoring_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.proctoring_sessions OWNER TO postgres;

--
-- Name: publication_channels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.publication_channels (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    channel_name text NOT NULL,
    channel_type text NOT NULL,
    external_id text,
    published_at timestamp(3) without time zone,
    unpublished_at timestamp(3) without time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    stats jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.publication_channels FORCE ROW LEVEL SECURITY;

ALTER TABLE public.publication_channels OWNER TO postgres;

--
-- Name: qrtz_blob_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_blob_triggers (
    sched_name text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    blob_data bytea
);

ALTER TABLE public.qrtz_blob_triggers OWNER TO postgres;

--
-- Name: qrtz_calendars; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_calendars (
    sched_name text NOT NULL,
    calendar_name text NOT NULL,
    calendar bytea NOT NULL
);

ALTER TABLE public.qrtz_calendars OWNER TO postgres;

--
-- Name: qrtz_cron_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_cron_triggers (
    sched_name text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    cron_expression text NOT NULL,
    time_zone_id text
);

ALTER TABLE public.qrtz_cron_triggers OWNER TO postgres;

--
-- Name: qrtz_fired_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_fired_triggers (
    sched_name text NOT NULL,
    entry_id text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    instance_name text NOT NULL,
    fired_time bigint NOT NULL,
    sched_time bigint NOT NULL,
    priority integer NOT NULL,
    state text NOT NULL,
    job_name text,
    job_group text,
    is_nonconcurrent boolean NOT NULL,
    requests_recovery boolean,
    execution_group character varying(200)
);

ALTER TABLE public.qrtz_fired_triggers OWNER TO postgres;

--
-- Name: qrtz_job_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_job_details (
    sched_name text NOT NULL,
    job_name text NOT NULL,
    job_group text NOT NULL,
    description text,
    job_class_name text NOT NULL,
    is_durable boolean NOT NULL,
    is_nonconcurrent boolean NOT NULL,
    is_update_data boolean NOT NULL,
    requests_recovery boolean NOT NULL,
    job_data bytea
);

ALTER TABLE public.qrtz_job_details OWNER TO postgres;

--
-- Name: qrtz_locks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_locks (
    sched_name text NOT NULL,
    lock_name text NOT NULL
);

ALTER TABLE public.qrtz_locks OWNER TO postgres;

--
-- Name: qrtz_paused_trigger_grps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_paused_trigger_grps (
    sched_name text NOT NULL,
    trigger_group text NOT NULL
);

ALTER TABLE public.qrtz_paused_trigger_grps OWNER TO postgres;

--
-- Name: qrtz_scheduler_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_scheduler_state (
    sched_name text NOT NULL,
    instance_name text NOT NULL,
    last_checkin_time bigint NOT NULL,
    checkin_interval bigint NOT NULL
);

ALTER TABLE public.qrtz_scheduler_state OWNER TO postgres;

--
-- Name: qrtz_simple_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_simple_triggers (
    sched_name text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    repeat_count bigint NOT NULL,
    repeat_interval bigint NOT NULL,
    times_triggered bigint NOT NULL
);

ALTER TABLE public.qrtz_simple_triggers OWNER TO postgres;

--
-- Name: qrtz_simprop_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_simprop_triggers (
    sched_name text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    str_prop_1 text,
    str_prop_2 text,
    str_prop_3 text,
    int_prop_1 integer,
    int_prop_2 integer,
    long_prop_1 bigint,
    long_prop_2 bigint,
    dec_prop_1 numeric,
    dec_prop_2 numeric,
    bool_prop_1 boolean,
    bool_prop_2 boolean,
    time_zone_id text
);

ALTER TABLE public.qrtz_simprop_triggers OWNER TO postgres;

--
-- Name: qrtz_triggers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qrtz_triggers (
    sched_name text NOT NULL,
    trigger_name text NOT NULL,
    trigger_group text NOT NULL,
    job_name text NOT NULL,
    job_group text NOT NULL,
    description text,
    next_fire_time bigint,
    prev_fire_time bigint,
    priority integer,
    trigger_state text NOT NULL,
    trigger_type text NOT NULL,
    start_time bigint NOT NULL,
    end_time bigint,
    calendar_name text,
    misfire_instr smallint,
    misfire_orig_fire_time bigint,
    execution_group character varying(200),
    job_data bytea
);

ALTER TABLE public.qrtz_triggers OWNER TO postgres;

--
-- Name: rater_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rater_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    subject_user_id uuid NOT NULL,
    rater_user_id uuid NOT NULL,
    relationship public."RaterRelationship" NOT NULL,
    status public."RaterAssignmentStatus" DEFAULT 'pending'::public."RaterAssignmentStatus" NOT NULL,
    submitted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.rater_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.rater_assignments OWNER TO postgres;

--
-- Name: rater_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rater_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    competency_key text NOT NULL,
    rating integer NOT NULL,
    comment character varying(5000),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.rater_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.rater_responses OWNER TO postgres;

--
-- Name: recognitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recognitions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    category text NOT NULL,
    message text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.recognitions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.recognitions OWNER TO postgres;

--
-- Name: referrals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referrals (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    referrer_email text NOT NULL,
    referrer_name text,
    candidate_email text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    applied_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.referrals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.referrals OWNER TO postgres;

--
-- Name: review_cycles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.review_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    status public."ReviewCycleStatus" DEFAULT 'draft'::public."ReviewCycleStatus" NOT NULL,
    opens_at timestamp(3) without time zone,
    closes_at timestamp(3) without time zone,
    published_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.review_cycles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.review_cycles OWNER TO postgres;

--
-- Name: role_family_weight_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_family_weight_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    weights jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.role_family_weight_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.role_family_weight_profiles OWNER TO postgres;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    scope text DEFAULT 'own'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.role_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: salary_adjustments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_adjustments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    previous_salary double precision NOT NULL,
    new_salary double precision NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by_id uuid,
    effective_date timestamp(3) without time zone,
    requested_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL
);

ALTER TABLE ONLY public.salary_adjustments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.salary_adjustments OWNER TO postgres;

--
-- Name: salary_bands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_bands (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    level text NOT NULL,
    title text,
    min_salary double precision NOT NULL,
    mid_salary double precision NOT NULL,
    max_salary double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.salary_bands FORCE ROW LEVEL SECURITY;

ALTER TABLE public.salary_bands OWNER TO postgres;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    ip_address text,
    user_agent text,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: stage_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stage_movements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid NOT NULL,
    from_stage_id uuid,
    to_stage_id uuid NOT NULL,
    moved_by uuid NOT NULL,
    reason text,
    moved_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.stage_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stage_movements OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    plan public."OrgPlan" DEFAULT 'trial'::public."OrgPlan" NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'trialing'::public."SubscriptionStatus" NOT NULL,
    current_period_start timestamp(3) without time zone,
    current_period_end timestamp(3) without time zone,
    trial_ends_at timestamp(3) without time zone,
    cancelled_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    last_stripe_event_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: successors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.successors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    critical_role_id uuid NOT NULL,
    user_id uuid NOT NULL,
    readiness text NOT NULL,
    type text NOT NULL,
    development_plan text,
    added_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.successors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.successors OWNER TO postgres;

--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.survey_responses (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    survey_id uuid NOT NULL,
    user_id uuid,
    answers jsonb NOT NULL,
    submitted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.survey_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.survey_responses OWNER TO postgres;

--
-- Name: surveys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.surveys (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    questions jsonb NOT NULL,
    target_groups jsonb,
    starts_at timestamp(3) without time zone,
    ends_at timestamp(3) without time zone,
    response_count integer DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.surveys FORCE ROW LEVEL SECURITY;

ALTER TABLE public.surveys OWNER TO postgres;

--
-- Name: sync_errors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sync_errors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    error_type text NOT NULL,
    message text NOT NULL,
    details jsonb,
    retry_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.sync_errors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sync_errors OWNER TO postgres;

--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teams (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    name text NOT NULL,
    leader_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.teams FORCE ROW LEVEL SECURITY;

ALTER TABLE public.teams OWNER TO postgres;

--
-- Name: user_business_units; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_business_units (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.user_business_units FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_business_units OWNER TO postgres;

--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    assigned_by uuid,
    company_scope uuid,
    unit_scope uuid,
    expires_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.user_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: user_teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_teams (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.user_teams FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_teams OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    organization_id uuid,
    supabase_user_id text NOT NULL,
    email text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    display_name text,
    avatar text,
    phone text,
    job_title text,
    company_id uuid,
    business_unit_id uuid,
    locale text DEFAULT 'es'::text NOT NULL,
    timezone text DEFAULT 'America/Bogota'::text NOT NULL,
    mfa_enabled boolean DEFAULT false NOT NULL,
    is_platform_owner boolean DEFAULT false NOT NULL,
    last_login_at timestamp(3) without time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone,
    setup_checklist_dismissed_at timestamp(3) without time zone
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;

ALTER TABLE public.users OWNER TO postgres;

--
-- Name: vacancies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vacancies (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid,
    business_unit_id uuid,
    team_id uuid,
    title text NOT NULL,
    description text,
    positions integer DEFAULT 1 NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    salary jsonb,
    contract_type text,
    location text,
    remote_policy text,
    created_by uuid NOT NULL,
    assigned_to uuid,
    closed_at timestamp(3) without time zone,
    closed_reason text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone,
    social_description text,
    whatsapp_description text,
    role_family text
);

ALTER TABLE ONLY public.vacancies FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vacancies OWNER TO postgres;

--
-- Name: vacancy_approvals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vacancy_approvals (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    vacancy_id uuid NOT NULL,
    approver_id uuid NOT NULL,
    step integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    comment text,
    decided_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.vacancy_approvals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vacancy_approvals OWNER TO postgres;

--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webhooks (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    url text NOT NULL,
    events jsonb NOT NULL,
    secret text,
    is_active boolean DEFAULT true NOT NULL,
    last_triggered_at timestamp(3) without time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public.webhooks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.webhooks OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: postgres
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text,
    created_by text,
    idempotency_key text,
    rollback text[]
);

ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;

--
-- Name: invoices invoice_number; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices ALTER COLUMN invoice_number SET DEFAULT nextval('public.invoices_invoice_number_seq'::regclass);

--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."__EFMigrationsHistory"
    ADD CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId");

--
-- Name: fx_rates PK_fx_rates; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT "PK_fx_rates" PRIMARY KEY (id);

--
-- Name: hris_connectors PK_hris_connectors; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hris_connectors
    ADD CONSTRAINT "PK_hris_connectors" PRIMARY KEY (id);

--
-- Name: hris_external_employees PK_hris_external_employees; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hris_external_employees
    ADD CONSTRAINT "PK_hris_external_employees" PRIMARY KEY (id);

--
-- Name: hris_sync_record_errors PK_hris_sync_record_errors; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hris_sync_record_errors
    ADD CONSTRAINT "PK_hris_sync_record_errors" PRIMARY KEY (id);

--
-- Name: hris_sync_runs PK_hris_sync_runs; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hris_sync_runs
    ADD CONSTRAINT "PK_hris_sync_runs" PRIMARY KEY (id);

--
-- Name: access_reviews access_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_reviews
    ADD CONSTRAINT access_reviews_pkey PRIMARY KEY (id);

--
-- Name: action_plans action_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_plans
    ADD CONSTRAINT action_plans_pkey PRIMARY KEY (id);

--
-- Name: ai_agent_org_configs ai_agent_org_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agent_org_configs
    ADD CONSTRAINT ai_agent_org_configs_pkey PRIMARY KEY (id);

--
-- Name: ai_agent_usage_logs ai_agent_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agent_usage_logs
    ADD CONSTRAINT ai_agent_usage_logs_pkey PRIMARY KEY (id);

--
-- Name: ai_agents ai_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_pkey PRIMARY KEY (id);

--
-- Name: ai_interview_sessions ai_interview_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_pkey PRIMARY KEY (id);

--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);

--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);

--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

--
-- Name: assessment_assignments assessment_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_assignments
    ADD CONSTRAINT assessment_assignments_pkey PRIMARY KEY (id);

--
-- Name: assessment_consents assessment_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_consents
    ADD CONSTRAINT assessment_consents_pkey PRIMARY KEY (id);

--
-- Name: assessment_questions assessment_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_pkey PRIMARY KEY (id);

--
-- Name: assessment_responses assessment_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_pkey PRIMARY KEY (id);

--
-- Name: assessment_results assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_pkey PRIMARY KEY (id);

--
-- Name: assessment_types assessment_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_types
    ADD CONSTRAINT assessment_types_pkey PRIMARY KEY (id);

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: benefit_enrollments benefit_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.benefit_enrollments
    ADD CONSTRAINT benefit_enrollments_pkey PRIMARY KEY (id);

--
-- Name: benefit_plans benefit_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.benefit_plans
    ADD CONSTRAINT benefit_plans_pkey PRIMARY KEY (id);

--
-- Name: billing_profiles billing_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.billing_profiles
    ADD CONSTRAINT billing_profiles_pkey PRIMARY KEY (id);

--
-- Name: business_units business_units_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_pkey PRIMARY KEY (id);

--
-- Name: calibration_members calibration_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_members
    ADD CONSTRAINT calibration_members_pkey PRIMARY KEY (id);

--
-- Name: calibration_sessions calibration_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_sessions
    ADD CONSTRAINT calibration_sessions_pkey PRIMARY KEY (id);

--
-- Name: calibration_votes calibration_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_votes
    ADD CONSTRAINT calibration_votes_pkey PRIMARY KEY (id);

--
-- Name: candidate_documents candidate_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidate_documents
    ADD CONSTRAINT candidate_documents_pkey PRIMARY KEY (id);

--
-- Name: candidate_tags candidate_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidate_tags
    ADD CONSTRAINT candidate_tags_pkey PRIMARY KEY (id);

--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);

--
-- Name: certificates certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_pkey PRIMARY KEY (id);

--
-- Name: coaching_sessions coaching_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_pkey PRIMARY KEY (id);

--
-- Name: commitments commitments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commitments
    ADD CONSTRAINT commitments_pkey PRIMARY KEY (id);

--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

--
-- Name: connector_syncs connector_syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_syncs
    ADD CONSTRAINT connector_syncs_pkey PRIMARY KEY (id);

--
-- Name: connectors connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connectors
    ADD CONSTRAINT connectors_pkey PRIMARY KEY (id);

--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

--
-- Name: critical_roles critical_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.critical_roles
    ADD CONSTRAINT critical_roles_pkey PRIMARY KEY (id);

--
-- Name: data_access_logs data_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_access_logs
    ADD CONSTRAINT data_access_logs_pkey PRIMARY KEY (id);

--
-- Name: data_consents data_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_consents
    ADD CONSTRAINT data_consents_pkey PRIMARY KEY (id);

--
-- Name: employee_compensations employee_compensations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_compensations
    ADD CONSTRAINT employee_compensations_pkey PRIMARY KEY (id);

--
-- Name: employee_demographics employee_demographics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_demographics
    ADD CONSTRAINT employee_demographics_pkey PRIMARY KEY (id);

--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);

--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);

--
-- Name: feedbacks feedbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feedbacks
    ADD CONSTRAINT feedbacks_pkey PRIMARY KEY (id);

--
-- Name: fit_scores fit_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fit_scores
    ADD CONSTRAINT fit_scores_pkey PRIMARY KEY (id);

--
-- Name: hire_predictions hire_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_pkey PRIMARY KEY (id);

--
-- Name: interview_evaluators interview_evaluators_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_evaluators
    ADD CONSTRAINT interview_evaluators_pkey PRIMARY KEY (id);

--
-- Name: interview_scorecards interview_scorecards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_scorecards
    ADD CONSTRAINT interview_scorecards_pkey PRIMARY KEY (id);

--
-- Name: interview_summaries interview_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_summaries
    ADD CONSTRAINT interview_summaries_pkey PRIMARY KEY (id);

--
-- Name: interviews interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);

--
-- Name: invoice_line_items invoice_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_pkey PRIMARY KEY (id);

--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

--
-- Name: job_profiles job_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_profiles
    ADD CONSTRAINT job_profiles_pkey PRIMARY KEY (id);

--
-- Name: key_results key_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_pkey PRIMARY KEY (id);

--
-- Name: leader_commitments leader_commitments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leader_commitments
    ADD CONSTRAINT leader_commitments_pkey PRIMARY KEY (id);

--
-- Name: learning_path_courses learning_path_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_path_courses
    ADD CONSTRAINT learning_path_courses_pkey PRIMARY KEY (id);

--
-- Name: learning_paths learning_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_paths
    ADD CONSTRAINT learning_paths_pkey PRIMARY KEY (id);

--
-- Name: legal_checks legal_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_checks
    ADD CONSTRAINT legal_checks_pkey PRIMARY KEY (id);

--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (code);

--
-- Name: nine_box_evaluations nine_box_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nine_box_evaluations
    ADD CONSTRAINT nine_box_evaluations_pkey PRIMARY KEY (id);

--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: offer_approvals offer_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_approvals
    ADD CONSTRAINT offer_approvals_pkey PRIMARY KEY (id);

--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);

--
-- Name: okrs okrs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_pkey PRIMARY KEY (id);

--
-- Name: onboarding_check_ins onboarding_check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_check_ins
    ADD CONSTRAINT onboarding_check_ins_pkey PRIMARY KEY (id);

--
-- Name: onboarding_plans onboarding_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_pkey PRIMARY KEY (id);

--
-- Name: onboarding_tasks onboarding_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_tasks
    ADD CONSTRAINT onboarding_tasks_pkey PRIMARY KEY (id);

--
-- Name: org_entitlements org_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org_entitlements
    ADD CONSTRAINT org_entitlements_pkey PRIMARY KEY (id);

--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);

--
-- Name: plan_modules plan_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_modules
    ADD CONSTRAINT plan_modules_pkey PRIMARY KEY (id);

--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (code);

--
-- Name: platform_invitations platform_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_pkey PRIMARY KEY (id);

--
-- Name: platform_owner_emails platform_owner_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_owner_emails
    ADD CONSTRAINT platform_owner_emails_pkey PRIMARY KEY (id);

--
-- Name: preemployment_validations preemployment_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.preemployment_validations
    ADD CONSTRAINT preemployment_validations_pkey PRIMARY KEY (id);

--
-- Name: proctoring_sessions proctoring_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proctoring_sessions
    ADD CONSTRAINT proctoring_sessions_pkey PRIMARY KEY (id);

--
-- Name: publication_channels publication_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.publication_channels
    ADD CONSTRAINT publication_channels_pkey PRIMARY KEY (id);

--
-- Name: qrtz_blob_triggers qrtz_blob_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_blob_triggers
    ADD CONSTRAINT qrtz_blob_triggers_pkey PRIMARY KEY (sched_name, trigger_name, trigger_group);

--
-- Name: qrtz_calendars qrtz_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_calendars
    ADD CONSTRAINT qrtz_calendars_pkey PRIMARY KEY (sched_name, calendar_name);

--
-- Name: qrtz_cron_triggers qrtz_cron_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_cron_triggers
    ADD CONSTRAINT qrtz_cron_triggers_pkey PRIMARY KEY (sched_name, trigger_name, trigger_group);

--
-- Name: qrtz_fired_triggers qrtz_fired_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_fired_triggers
    ADD CONSTRAINT qrtz_fired_triggers_pkey PRIMARY KEY (sched_name, entry_id);

--
-- Name: qrtz_job_details qrtz_job_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_job_details
    ADD CONSTRAINT qrtz_job_details_pkey PRIMARY KEY (sched_name, job_name, job_group);

--
-- Name: qrtz_locks qrtz_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_locks
    ADD CONSTRAINT qrtz_locks_pkey PRIMARY KEY (sched_name, lock_name);

--
-- Name: qrtz_paused_trigger_grps qrtz_paused_trigger_grps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_paused_trigger_grps
    ADD CONSTRAINT qrtz_paused_trigger_grps_pkey PRIMARY KEY (sched_name, trigger_group);

--
-- Name: qrtz_scheduler_state qrtz_scheduler_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_scheduler_state
    ADD CONSTRAINT qrtz_scheduler_state_pkey PRIMARY KEY (sched_name, instance_name);

--
-- Name: qrtz_simple_triggers qrtz_simple_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_simple_triggers
    ADD CONSTRAINT qrtz_simple_triggers_pkey PRIMARY KEY (sched_name, trigger_name, trigger_group);

--
-- Name: qrtz_simprop_triggers qrtz_simprop_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_simprop_triggers
    ADD CONSTRAINT qrtz_simprop_triggers_pkey PRIMARY KEY (sched_name, trigger_name, trigger_group);

--
-- Name: qrtz_triggers qrtz_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_triggers
    ADD CONSTRAINT qrtz_triggers_pkey PRIMARY KEY (sched_name, trigger_name, trigger_group);

--
-- Name: rater_assignments rater_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_assignments
    ADD CONSTRAINT rater_assignments_pkey PRIMARY KEY (id);

--
-- Name: rater_responses rater_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_responses
    ADD CONSTRAINT rater_responses_pkey PRIMARY KEY (id);

--
-- Name: recognitions recognitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recognitions
    ADD CONSTRAINT recognitions_pkey PRIMARY KEY (id);

--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);

--
-- Name: review_cycles review_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.review_cycles
    ADD CONSTRAINT review_cycles_pkey PRIMARY KEY (id);

--
-- Name: role_family_weight_profiles role_family_weight_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_family_weight_profiles
    ADD CONSTRAINT role_family_weight_profiles_pkey PRIMARY KEY (id);

--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);

--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

--
-- Name: salary_adjustments salary_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_adjustments
    ADD CONSTRAINT salary_adjustments_pkey PRIMARY KEY (id);

--
-- Name: salary_bands salary_bands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_bands
    ADD CONSTRAINT salary_bands_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: stage_movements stage_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_movements
    ADD CONSTRAINT stage_movements_pkey PRIMARY KEY (id);

--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

--
-- Name: successors successors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.successors
    ADD CONSTRAINT successors_pkey PRIMARY KEY (id);

--
-- Name: survey_responses survey_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);

--
-- Name: surveys surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);

--
-- Name: sync_errors sync_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sync_errors
    ADD CONSTRAINT sync_errors_pkey PRIMARY KEY (id);

--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

--
-- Name: user_business_units user_business_units_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_business_units
    ADD CONSTRAINT user_business_units_pkey PRIMARY KEY (id);

--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

--
-- Name: user_teams user_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_pkey PRIMARY KEY (id);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: vacancies vacancies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_pkey PRIMARY KEY (id);

--
-- Name: vacancy_approvals vacancy_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancy_approvals
    ADD CONSTRAINT vacancy_approvals_pkey PRIMARY KEY (id);

--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);

--
-- Name: schema_migrations schema_migrations_idempotency_key_key; Type: CONSTRAINT; Schema: supabase_migrations; Owner: postgres
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_idempotency_key_key UNIQUE (idempotency_key);

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: postgres
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

--
-- Name: access_reviews_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX access_reviews_organization_id_idx ON public.access_reviews USING btree (organization_id);

--
-- Name: access_reviews_organization_id_reviewed_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX access_reviews_organization_id_reviewed_at_idx ON public.access_reviews USING btree (organization_id, reviewed_at);

--
-- Name: access_reviews_reviewer_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX access_reviews_reviewer_id_idx ON public.access_reviews USING btree (reviewer_id);

--
-- Name: action_plans_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX action_plans_organization_id_idx ON public.action_plans USING btree (organization_id);

--
-- Name: action_plans_responsible_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX action_plans_responsible_id_idx ON public.action_plans USING btree (responsible_id);

--
-- Name: ai_agent_org_configs_agent_id_organization_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ai_agent_org_configs_agent_id_organization_id_key ON public.ai_agent_org_configs USING btree (agent_id, organization_id);

--
-- Name: ai_agent_org_configs_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_agent_org_configs_organization_id_idx ON public.ai_agent_org_configs USING btree (organization_id);

--
-- Name: ai_agent_usage_logs_agent_id_organization_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_agent_usage_logs_agent_id_organization_id_created_at_idx ON public.ai_agent_usage_logs USING btree (agent_id, organization_id, created_at);

--
-- Name: ai_agents_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ai_agents_slug_key ON public.ai_agents USING btree (slug);

--
-- Name: ai_interview_sessions_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_interview_sessions_candidate_id_idx ON public.ai_interview_sessions USING btree (candidate_id);

--
-- Name: ai_interview_sessions_candidate_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ai_interview_sessions_candidate_token_key ON public.ai_interview_sessions USING btree (candidate_token);

--
-- Name: ai_interview_sessions_elevenlabs_conversation_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ai_interview_sessions_elevenlabs_conversation_id_key ON public.ai_interview_sessions USING btree (elevenlabs_conversation_id);

--
-- Name: ai_interview_sessions_interview_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ai_interview_sessions_interview_id_key ON public.ai_interview_sessions USING btree (interview_id);

--
-- Name: ai_interview_sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_interview_sessions_organization_id_idx ON public.ai_interview_sessions USING btree (organization_id);

--
-- Name: ai_interview_sessions_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_interview_sessions_vacancy_id_idx ON public.ai_interview_sessions USING btree (vacancy_id);

--
-- Name: alert_rules_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alert_rules_created_by_id_idx ON public.alert_rules USING btree (created_by_id);

--
-- Name: alert_rules_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alert_rules_organization_id_idx ON public.alert_rules USING btree (organization_id);

--
-- Name: alerts_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_created_at_idx ON public.alerts USING btree (created_at);

--
-- Name: alerts_dismissed_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_dismissed_by_id_idx ON public.alerts USING btree (dismissed_by_id);

--
-- Name: alerts_organization_id_severity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_organization_id_severity_idx ON public.alerts USING btree (organization_id, severity);

--
-- Name: alerts_organization_id_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_organization_id_status_idx ON public.alerts USING btree (organization_id, status);

--
-- Name: alerts_rule_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_rule_id_idx ON public.alerts USING btree (rule_id);

--
-- Name: api_keys_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX api_keys_created_by_id_idx ON public.api_keys USING btree (created_by_id);

--
-- Name: api_keys_key_hash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX api_keys_key_hash_idx ON public.api_keys USING btree (key_hash);

--
-- Name: api_keys_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX api_keys_organization_id_idx ON public.api_keys USING btree (organization_id);

--
-- Name: applications_candidate_id_vacancy_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX applications_candidate_id_vacancy_id_key ON public.applications USING btree (candidate_id, vacancy_id);

--
-- Name: applications_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX applications_organization_id_idx ON public.applications USING btree (organization_id);

--
-- Name: applications_organization_id_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX applications_organization_id_status_idx ON public.applications USING btree (organization_id, status);

--
-- Name: applications_vacancy_id_current_stage_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX applications_vacancy_id_current_stage_id_idx ON public.applications USING btree (vacancy_id, current_stage_id);

--
-- Name: assessment_assignments_assessment_type_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_assignments_assessment_type_id_idx ON public.assessment_assignments USING btree (assessment_type_id);

--
-- Name: assessment_assignments_assigned_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_assignments_assigned_by_id_idx ON public.assessment_assignments USING btree (assigned_by_id);

--
-- Name: assessment_assignments_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_assignments_candidate_id_idx ON public.assessment_assignments USING btree (candidate_id);

--
-- Name: assessment_assignments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_assignments_organization_id_idx ON public.assessment_assignments USING btree (organization_id);

--
-- Name: assessment_assignments_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_assignments_vacancy_id_idx ON public.assessment_assignments USING btree (vacancy_id);

--
-- Name: assessment_consents_assignment_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX assessment_consents_assignment_id_key ON public.assessment_consents USING btree (assignment_id);

--
-- Name: assessment_consents_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_consents_candidate_id_idx ON public.assessment_consents USING btree (candidate_id);

--
-- Name: assessment_consents_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_consents_organization_id_idx ON public.assessment_consents USING btree (organization_id);

--
-- Name: assessment_questions_assessment_type_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_questions_assessment_type_id_idx ON public.assessment_questions USING btree (assessment_type_id);

--
-- Name: assessment_questions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_questions_organization_id_idx ON public.assessment_questions USING btree (organization_id);

--
-- Name: assessment_responses_assignment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_responses_assignment_id_idx ON public.assessment_responses USING btree (assignment_id);

--
-- Name: assessment_responses_assignment_id_question_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX assessment_responses_assignment_id_question_id_key ON public.assessment_responses USING btree (assignment_id, question_id);

--
-- Name: assessment_responses_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_responses_organization_id_idx ON public.assessment_responses USING btree (organization_id);

--
-- Name: assessment_responses_question_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_responses_question_id_idx ON public.assessment_responses USING btree (question_id);

--
-- Name: assessment_results_assignment_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX assessment_results_assignment_id_key ON public.assessment_results USING btree (assignment_id);

--
-- Name: assessment_results_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_results_organization_id_idx ON public.assessment_results USING btree (organization_id);

--
-- Name: assessment_types_organization_id_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX assessment_types_organization_id_code_key ON public.assessment_types USING btree (organization_id, code);

--
-- Name: assessment_types_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_types_organization_id_idx ON public.assessment_types USING btree (organization_id);

--
-- Name: audit_logs_actor_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_logs_actor_id_idx ON public.audit_logs USING btree (actor_id);

--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);

--
-- Name: audit_logs_organization_id_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_logs_organization_id_entity_idx ON public.audit_logs USING btree (organization_id, entity);

--
-- Name: audit_logs_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_logs_organization_id_idx ON public.audit_logs USING btree (organization_id);

--
-- Name: audit_logs_organization_id_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_logs_organization_id_user_id_idx ON public.audit_logs USING btree (organization_id, user_id);

--
-- Name: benefit_enrollments_benefit_plan_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX benefit_enrollments_benefit_plan_id_idx ON public.benefit_enrollments USING btree (benefit_plan_id);

--
-- Name: benefit_enrollments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX benefit_enrollments_organization_id_idx ON public.benefit_enrollments USING btree (organization_id);

--
-- Name: benefit_enrollments_user_id_benefit_plan_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX benefit_enrollments_user_id_benefit_plan_id_key ON public.benefit_enrollments USING btree (user_id, benefit_plan_id);

--
-- Name: benefit_plans_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX benefit_plans_organization_id_idx ON public.benefit_plans USING btree (organization_id);

--
-- Name: billing_profiles_organization_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX billing_profiles_organization_id_key ON public.billing_profiles USING btree (organization_id);

--
-- Name: business_units_company_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX business_units_company_id_idx ON public.business_units USING btree (company_id);

--
-- Name: business_units_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX business_units_organization_id_idx ON public.business_units USING btree (organization_id);

--
-- Name: business_units_parent_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX business_units_parent_id_idx ON public.business_units USING btree (parent_id);

--
-- Name: calibration_members_session_id_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX calibration_members_session_id_user_id_key ON public.calibration_members USING btree (session_id, user_id);

--
-- Name: calibration_members_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX calibration_members_user_id_idx ON public.calibration_members USING btree (user_id);

--
-- Name: calibration_sessions_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX calibration_sessions_created_by_id_idx ON public.calibration_sessions USING btree (created_by_id);

--
-- Name: calibration_sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX calibration_sessions_organization_id_idx ON public.calibration_sessions USING btree (organization_id);

--
-- Name: calibration_votes_evaluated_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX calibration_votes_evaluated_user_id_idx ON public.calibration_votes USING btree (evaluated_user_id);

--
-- Name: calibration_votes_session_id_evaluated_user_id_voter_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX calibration_votes_session_id_evaluated_user_id_voter_id_key ON public.calibration_votes USING btree (session_id, evaluated_user_id, voter_id);

--
-- Name: calibration_votes_voter_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX calibration_votes_voter_id_idx ON public.calibration_votes USING btree (voter_id);

--
-- Name: candidate_documents_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidate_documents_candidate_id_idx ON public.candidate_documents USING btree (candidate_id);

--
-- Name: candidate_documents_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidate_documents_organization_id_idx ON public.candidate_documents USING btree (organization_id);

--
-- Name: candidate_tags_candidate_id_tag_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX candidate_tags_candidate_id_tag_key ON public.candidate_tags USING btree (candidate_id, tag);

--
-- Name: candidate_tags_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidate_tags_organization_id_idx ON public.candidate_tags USING btree (organization_id);

--
-- Name: candidates_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidates_created_by_id_idx ON public.candidates USING btree (created_by_id);

--
-- Name: candidates_organization_id_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX candidates_organization_id_email_key ON public.candidates USING btree (organization_id, email);

--
-- Name: candidates_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidates_organization_id_idx ON public.candidates USING btree (organization_id);

--
-- Name: candidates_organization_id_pool_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX candidates_organization_id_pool_type_idx ON public.candidates USING btree (organization_id, pool_type);

--
-- Name: certificates_course_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX certificates_course_id_idx ON public.certificates USING btree (course_id);

--
-- Name: certificates_enrollment_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX certificates_enrollment_id_key ON public.certificates USING btree (enrollment_id);

--
-- Name: certificates_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX certificates_organization_id_idx ON public.certificates USING btree (organization_id);

--
-- Name: certificates_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX certificates_user_id_idx ON public.certificates USING btree (user_id);

--
-- Name: coaching_sessions_employee_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX coaching_sessions_employee_id_idx ON public.coaching_sessions USING btree (employee_id);

--
-- Name: coaching_sessions_leader_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX coaching_sessions_leader_id_idx ON public.coaching_sessions USING btree (leader_id);

--
-- Name: coaching_sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX coaching_sessions_organization_id_idx ON public.coaching_sessions USING btree (organization_id);

--
-- Name: commitments_coaching_session_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX commitments_coaching_session_id_idx ON public.commitments USING btree (coaching_session_id);

--
-- Name: commitments_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX commitments_created_by_id_idx ON public.commitments USING btree (created_by_id);

--
-- Name: commitments_employee_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX commitments_employee_id_idx ON public.commitments USING btree (employee_id);

--
-- Name: commitments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX commitments_organization_id_idx ON public.commitments USING btree (organization_id);

--
-- Name: companies_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX companies_organization_id_idx ON public.companies USING btree (organization_id);

--
-- Name: connector_syncs_connector_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_syncs_connector_id_idx ON public.connector_syncs USING btree (connector_id);

--
-- Name: connector_syncs_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_syncs_organization_id_idx ON public.connector_syncs USING btree (organization_id);

--
-- Name: connectors_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connectors_created_by_id_idx ON public.connectors USING btree (created_by_id);

--
-- Name: connectors_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connectors_organization_id_idx ON public.connectors USING btree (organization_id);

--
-- Name: courses_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX courses_created_by_id_idx ON public.courses USING btree (created_by_id);

--
-- Name: courses_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX courses_organization_id_idx ON public.courses USING btree (organization_id);

--
-- Name: critical_roles_company_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX critical_roles_company_id_idx ON public.critical_roles USING btree (company_id);

--
-- Name: critical_roles_current_holder_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX critical_roles_current_holder_id_idx ON public.critical_roles USING btree (current_holder_id);

--
-- Name: critical_roles_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX critical_roles_organization_id_idx ON public.critical_roles USING btree (organization_id);

--
-- Name: critical_roles_unit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX critical_roles_unit_id_idx ON public.critical_roles USING btree (unit_id);

--
-- Name: data_access_logs_actor_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX data_access_logs_actor_id_idx ON public.data_access_logs USING btree (actor_id);

--
-- Name: data_access_logs_data_type_record_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX data_access_logs_data_type_record_id_idx ON public.data_access_logs USING btree (data_type, record_id);

--
-- Name: data_access_logs_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX data_access_logs_organization_id_idx ON public.data_access_logs USING btree (organization_id);

--
-- Name: data_consents_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX data_consents_organization_id_idx ON public.data_consents USING btree (organization_id);

--
-- Name: data_consents_subject_user_id_consent_type_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX data_consents_subject_user_id_consent_type_key ON public.data_consents USING btree (subject_user_id, consent_type);

--
-- Name: employee_compensations_band_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX employee_compensations_band_id_idx ON public.employee_compensations USING btree (band_id);

--
-- Name: employee_compensations_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX employee_compensations_organization_id_idx ON public.employee_compensations USING btree (organization_id);

--
-- Name: employee_compensations_organization_id_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX employee_compensations_organization_id_user_id_key ON public.employee_compensations USING btree (organization_id, user_id);

--
-- Name: employee_demographics_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX employee_demographics_organization_id_idx ON public.employee_demographics USING btree (organization_id);

--
-- Name: employee_demographics_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX employee_demographics_user_id_key ON public.employee_demographics USING btree (user_id);

--
-- Name: enrollments_course_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX enrollments_course_id_idx ON public.enrollments USING btree (course_id);

--
-- Name: enrollments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX enrollments_organization_id_idx ON public.enrollments USING btree (organization_id);

--
-- Name: enrollments_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX enrollments_user_id_idx ON public.enrollments USING btree (user_id);

--
-- Name: feature_flags_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX feature_flags_organization_id_idx ON public.feature_flags USING btree (organization_id);

--
-- Name: feature_flags_organization_id_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX feature_flags_organization_id_key_key ON public.feature_flags USING btree (organization_id, key);

--
-- Name: feedbacks_from_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX feedbacks_from_user_id_idx ON public.feedbacks USING btree (from_user_id);

--
-- Name: feedbacks_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX feedbacks_organization_id_idx ON public.feedbacks USING btree (organization_id);

--
-- Name: feedbacks_to_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX feedbacks_to_user_id_idx ON public.feedbacks USING btree (to_user_id);

--
-- Name: fit_scores_candidate_id_vacancy_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fit_scores_candidate_id_vacancy_id_key ON public.fit_scores USING btree (candidate_id, vacancy_id);

--
-- Name: fit_scores_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fit_scores_organization_id_idx ON public.fit_scores USING btree (organization_id);

--
-- Name: fit_scores_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fit_scores_vacancy_id_idx ON public.fit_scores USING btree (vacancy_id);

--
-- Name: hire_predictions_application_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_application_id_idx ON public.hire_predictions USING btree (application_id);

--
-- Name: hire_predictions_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_candidate_id_idx ON public.hire_predictions USING btree (candidate_id);

--
-- Name: hire_predictions_hired_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_hired_by_id_idx ON public.hire_predictions USING btree (hired_by_id);

--
-- Name: hire_predictions_offer_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX hire_predictions_offer_id_key ON public.hire_predictions USING btree (offer_id);

--
-- Name: hire_predictions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_organization_id_idx ON public.hire_predictions USING btree (organization_id);

--
-- Name: hire_predictions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_user_id_idx ON public.hire_predictions USING btree (user_id);

--
-- Name: hire_predictions_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX hire_predictions_vacancy_id_idx ON public.hire_predictions USING btree (vacancy_id);

--
-- Name: idx_qrtz_ft_job_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_job_group ON public.qrtz_fired_triggers USING btree (job_group);

--
-- Name: idx_qrtz_ft_job_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_job_name ON public.qrtz_fired_triggers USING btree (job_name);

--
-- Name: idx_qrtz_ft_job_req_recovery; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_job_req_recovery ON public.qrtz_fired_triggers USING btree (requests_recovery);

--
-- Name: idx_qrtz_ft_trig_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_trig_group ON public.qrtz_fired_triggers USING btree (trigger_group);

--
-- Name: idx_qrtz_ft_trig_inst_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_trig_inst_name ON public.qrtz_fired_triggers USING btree (instance_name);

--
-- Name: idx_qrtz_ft_trig_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_trig_name ON public.qrtz_fired_triggers USING btree (trigger_name);

--
-- Name: idx_qrtz_ft_trig_nm_gp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_ft_trig_nm_gp ON public.qrtz_fired_triggers USING btree (sched_name, trigger_name, trigger_group);

--
-- Name: idx_qrtz_j_req_recovery; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_j_req_recovery ON public.qrtz_job_details USING btree (requests_recovery);

--
-- Name: idx_qrtz_t_next_fire_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_t_next_fire_time ON public.qrtz_triggers USING btree (next_fire_time);

--
-- Name: idx_qrtz_t_nft_st; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_t_nft_st ON public.qrtz_triggers USING btree (next_fire_time, trigger_state);

--
-- Name: idx_qrtz_t_state; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qrtz_t_state ON public.qrtz_triggers USING btree (trigger_state);

--
-- Name: interview_evaluators_interview_id_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX interview_evaluators_interview_id_user_id_key ON public.interview_evaluators USING btree (interview_id, user_id);

--
-- Name: interview_evaluators_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interview_evaluators_user_id_idx ON public.interview_evaluators USING btree (user_id);

--
-- Name: interview_scorecards_evaluator_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interview_scorecards_evaluator_id_idx ON public.interview_scorecards USING btree (evaluator_id);

--
-- Name: interview_scorecards_interview_id_evaluator_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX interview_scorecards_interview_id_evaluator_id_key ON public.interview_scorecards USING btree (interview_id, evaluator_id);

--
-- Name: interview_scorecards_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interview_scorecards_organization_id_idx ON public.interview_scorecards USING btree (organization_id);

--
-- Name: interview_summaries_interview_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX interview_summaries_interview_id_key ON public.interview_summaries USING btree (interview_id);

--
-- Name: interview_summaries_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interview_summaries_organization_id_idx ON public.interview_summaries USING btree (organization_id);

--
-- Name: interviews_application_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_application_id_idx ON public.interviews USING btree (application_id);

--
-- Name: interviews_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_candidate_id_idx ON public.interviews USING btree (candidate_id);

--
-- Name: interviews_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_created_by_id_idx ON public.interviews USING btree (created_by_id);

--
-- Name: interviews_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_organization_id_idx ON public.interviews USING btree (organization_id);

--
-- Name: interviews_organization_id_scheduled_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_organization_id_scheduled_at_idx ON public.interviews USING btree (organization_id, scheduled_at);

--
-- Name: interviews_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX interviews_vacancy_id_idx ON public.interviews USING btree (vacancy_id);

--
-- Name: invoice_line_items_invoice_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_line_items_invoice_id_idx ON public.invoice_line_items USING btree (invoice_id);

--
-- Name: invoices_org_period_draft_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX invoices_org_period_draft_key ON public.invoices USING btree (organization_id, period_start, period_end) WHERE ((status = 'draft'::public."InvoiceStatus") AND (period_start IS NOT NULL) AND (period_end IS NOT NULL));

--
-- Name: invoices_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_organization_id_idx ON public.invoices USING btree (organization_id);

--
-- Name: invoices_organization_id_invoice_number_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX invoices_organization_id_invoice_number_key ON public.invoices USING btree (organization_id, invoice_number);

--
-- Name: invoices_subscription_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_subscription_id_idx ON public.invoices USING btree (subscription_id);

--
-- Name: ix_hris_external_employees_connector; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_hris_external_employees_connector ON public.hris_external_employees USING btree (connector_id);

--
-- Name: ix_hris_sync_record_errors_connector; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_hris_sync_record_errors_connector ON public.hris_sync_record_errors USING btree (connector_id);

--
-- Name: ix_hris_sync_record_errors_sync_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_hris_sync_record_errors_sync_run ON public.hris_sync_record_errors USING btree (sync_run_id);

--
-- Name: ix_hris_sync_runs_connector; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_hris_sync_runs_connector ON public.hris_sync_runs USING btree (connector_id);

--
-- Name: job_profiles_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX job_profiles_organization_id_idx ON public.job_profiles USING btree (organization_id);

--
-- Name: job_profiles_vacancy_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX job_profiles_vacancy_id_key ON public.job_profiles USING btree (vacancy_id);

--
-- Name: key_results_okr_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX key_results_okr_id_idx ON public.key_results USING btree (okr_id);

--
-- Name: key_results_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX key_results_organization_id_idx ON public.key_results USING btree (organization_id);

--
-- Name: leader_commitments_leader_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leader_commitments_leader_id_idx ON public.leader_commitments USING btree (leader_id);

--
-- Name: leader_commitments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leader_commitments_organization_id_idx ON public.leader_commitments USING btree (organization_id);

--
-- Name: learning_path_courses_course_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX learning_path_courses_course_id_idx ON public.learning_path_courses USING btree (course_id);

--
-- Name: learning_path_courses_path_id_course_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX learning_path_courses_path_id_course_id_key ON public.learning_path_courses USING btree (path_id, course_id);

--
-- Name: learning_paths_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX learning_paths_organization_id_idx ON public.learning_paths USING btree (organization_id);

--
-- Name: legal_checks_completed_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX legal_checks_completed_by_id_idx ON public.legal_checks USING btree (completed_by_id);

--
-- Name: legal_checks_offer_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX legal_checks_offer_id_idx ON public.legal_checks USING btree (offer_id);

--
-- Name: legal_checks_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX legal_checks_organization_id_idx ON public.legal_checks USING btree (organization_id);

--
-- Name: nine_box_evaluations_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX nine_box_evaluations_organization_id_idx ON public.nine_box_evaluations USING btree (organization_id);

--
-- Name: nine_box_evaluations_organization_id_user_id_period_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX nine_box_evaluations_organization_id_user_id_period_key ON public.nine_box_evaluations USING btree (organization_id, user_id, period);

--
-- Name: notification_preferences_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX notification_preferences_user_id_key ON public.notification_preferences USING btree (user_id);

--
-- Name: notifications_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_organization_id_idx ON public.notifications USING btree (organization_id);

--
-- Name: notifications_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_user_id_created_at_idx ON public.notifications USING btree (user_id, created_at);

--
-- Name: notifications_user_id_read_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_user_id_read_idx ON public.notifications USING btree (user_id, read);

--
-- Name: offer_approvals_approver_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offer_approvals_approver_id_idx ON public.offer_approvals USING btree (approver_id);

--
-- Name: offer_approvals_offer_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offer_approvals_offer_id_idx ON public.offer_approvals USING btree (offer_id);

--
-- Name: offer_approvals_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offer_approvals_organization_id_idx ON public.offer_approvals USING btree (organization_id);

--
-- Name: offers_application_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offers_application_id_idx ON public.offers USING btree (application_id);

--
-- Name: offers_candidate_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offers_candidate_id_idx ON public.offers USING btree (candidate_id);

--
-- Name: offers_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offers_created_by_id_idx ON public.offers USING btree (created_by_id);

--
-- Name: offers_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offers_organization_id_idx ON public.offers USING btree (organization_id);

--
-- Name: offers_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX offers_vacancy_id_idx ON public.offers USING btree (vacancy_id);

--
-- Name: okrs_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX okrs_created_by_id_idx ON public.okrs USING btree (created_by_id);

--
-- Name: okrs_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX okrs_organization_id_idx ON public.okrs USING btree (organization_id);

--
-- Name: okrs_team_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX okrs_team_id_idx ON public.okrs USING btree (team_id);

--
-- Name: okrs_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX okrs_user_id_idx ON public.okrs USING btree (user_id);

--
-- Name: onboarding_check_ins_completed_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_check_ins_completed_by_id_idx ON public.onboarding_check_ins USING btree (completed_by_id);

--
-- Name: onboarding_check_ins_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_check_ins_organization_id_idx ON public.onboarding_check_ins USING btree (organization_id);

--
-- Name: onboarding_check_ins_plan_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_check_ins_plan_id_idx ON public.onboarding_check_ins USING btree (plan_id);

--
-- Name: onboarding_plans_buddy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_plans_buddy_id_idx ON public.onboarding_plans USING btree (buddy_id);

--
-- Name: onboarding_plans_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_plans_created_by_id_idx ON public.onboarding_plans USING btree (created_by_id);

--
-- Name: onboarding_plans_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_plans_organization_id_idx ON public.onboarding_plans USING btree (organization_id);

--
-- Name: onboarding_plans_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_plans_user_id_idx ON public.onboarding_plans USING btree (user_id);

--
-- Name: onboarding_tasks_completed_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_tasks_completed_by_id_idx ON public.onboarding_tasks USING btree (completed_by_id);

--
-- Name: onboarding_tasks_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_tasks_organization_id_idx ON public.onboarding_tasks USING btree (organization_id);

--
-- Name: onboarding_tasks_plan_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_tasks_plan_id_idx ON public.onboarding_tasks USING btree (plan_id);

--
-- Name: org_entitlements_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX org_entitlements_organization_id_idx ON public.org_entitlements USING btree (organization_id);

--
-- Name: org_entitlements_organization_id_module_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX org_entitlements_organization_id_module_code_key ON public.org_entitlements USING btree (organization_id, module_code);

--
-- Name: organizations_domain_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX organizations_domain_key ON public.organizations USING btree (domain);

--
-- Name: organizations_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX organizations_slug_key ON public.organizations USING btree (slug);

--
-- Name: permissions_module_action_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX permissions_module_action_key ON public.permissions USING btree (module, action);

--
-- Name: pipeline_stages_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pipeline_stages_organization_id_idx ON public.pipeline_stages USING btree (organization_id);

--
-- Name: pipeline_stages_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pipeline_stages_vacancy_id_idx ON public.pipeline_stages USING btree (vacancy_id);

--
-- Name: plan_modules_plan_code_module_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX plan_modules_plan_code_module_code_key ON public.plan_modules USING btree (plan_code, module_code);

--
-- Name: platform_invitations_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_invitations_email_idx ON public.platform_invitations USING btree (email);

--
-- Name: platform_invitations_invited_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_invitations_invited_by_id_idx ON public.platform_invitations USING btree (invited_by_id);

--
-- Name: platform_invitations_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_invitations_organization_id_idx ON public.platform_invitations USING btree (organization_id);

--
-- Name: platform_invitations_token_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_invitations_token_idx ON public.platform_invitations USING btree (token);

--
-- Name: platform_invitations_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX platform_invitations_token_key ON public.platform_invitations USING btree (token);

--
-- Name: platform_owner_emails_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX platform_owner_emails_email_key ON public.platform_owner_emails USING btree (email);

--
-- Name: preemployment_validations_completed_by_api_key_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX preemployment_validations_completed_by_api_key_id_idx ON public.preemployment_validations USING btree (completed_by_api_key_id);

--
-- Name: preemployment_validations_completed_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX preemployment_validations_completed_by_id_idx ON public.preemployment_validations USING btree (completed_by_id);

--
-- Name: preemployment_validations_offer_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX preemployment_validations_offer_id_idx ON public.preemployment_validations USING btree (offer_id);

--
-- Name: preemployment_validations_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX preemployment_validations_organization_id_idx ON public.preemployment_validations USING btree (organization_id);

--
-- Name: proctoring_sessions_assignment_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX proctoring_sessions_assignment_id_key ON public.proctoring_sessions USING btree (assignment_id);

--
-- Name: proctoring_sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX proctoring_sessions_organization_id_idx ON public.proctoring_sessions USING btree (organization_id);

--
-- Name: publication_channels_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX publication_channels_organization_id_idx ON public.publication_channels USING btree (organization_id);

--
-- Name: publication_channels_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX publication_channels_vacancy_id_idx ON public.publication_channels USING btree (vacancy_id);

--
-- Name: rater_assignments_cycle_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_assignments_cycle_id_idx ON public.rater_assignments USING btree (cycle_id);

--
-- Name: rater_assignments_cycle_id_subject_user_id_rater_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX rater_assignments_cycle_id_subject_user_id_rater_user_id_key ON public.rater_assignments USING btree (cycle_id, subject_user_id, rater_user_id);

--
-- Name: rater_assignments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_assignments_organization_id_idx ON public.rater_assignments USING btree (organization_id);

--
-- Name: rater_assignments_rater_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_assignments_rater_user_id_idx ON public.rater_assignments USING btree (rater_user_id);

--
-- Name: rater_assignments_subject_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_assignments_subject_user_id_idx ON public.rater_assignments USING btree (subject_user_id);

--
-- Name: rater_responses_assignment_id_competency_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX rater_responses_assignment_id_competency_key_key ON public.rater_responses USING btree (assignment_id, competency_key);

--
-- Name: rater_responses_assignment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_responses_assignment_id_idx ON public.rater_responses USING btree (assignment_id);

--
-- Name: rater_responses_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rater_responses_organization_id_idx ON public.rater_responses USING btree (organization_id);

--
-- Name: recognitions_from_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recognitions_from_user_id_idx ON public.recognitions USING btree (from_user_id);

--
-- Name: recognitions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recognitions_organization_id_idx ON public.recognitions USING btree (organization_id);

--
-- Name: recognitions_to_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recognitions_to_user_id_idx ON public.recognitions USING btree (to_user_id);

--
-- Name: referrals_candidate_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX referrals_candidate_email_idx ON public.referrals USING btree (candidate_email);

--
-- Name: referrals_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX referrals_organization_id_idx ON public.referrals USING btree (organization_id);

--
-- Name: referrals_token_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX referrals_token_idx ON public.referrals USING btree (token);

--
-- Name: referrals_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX referrals_token_key ON public.referrals USING btree (token);

--
-- Name: referrals_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX referrals_vacancy_id_idx ON public.referrals USING btree (vacancy_id);

--
-- Name: review_cycles_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX review_cycles_organization_id_idx ON public.review_cycles USING btree (organization_id);

--
-- Name: role_family_weight_profiles_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX role_family_weight_profiles_organization_id_idx ON public.role_family_weight_profiles USING btree (organization_id);

--
-- Name: role_family_weight_profiles_organization_id_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX role_family_weight_profiles_organization_id_name_key ON public.role_family_weight_profiles USING btree (organization_id, name);

--
-- Name: role_permissions_permission_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX role_permissions_permission_id_idx ON public.role_permissions USING btree (permission_id);

--
-- Name: role_permissions_role_id_permission_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX role_permissions_role_id_permission_id_key ON public.role_permissions USING btree (role_id, permission_id);

--
-- Name: roles_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX roles_organization_id_idx ON public.roles USING btree (organization_id);

--
-- Name: roles_organization_id_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX roles_organization_id_slug_key ON public.roles USING btree (organization_id, slug);

--
-- Name: salary_adjustments_approved_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX salary_adjustments_approved_by_id_idx ON public.salary_adjustments USING btree (approved_by_id);

--
-- Name: salary_adjustments_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX salary_adjustments_organization_id_idx ON public.salary_adjustments USING btree (organization_id);

--
-- Name: salary_adjustments_requested_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX salary_adjustments_requested_by_id_idx ON public.salary_adjustments USING btree (requested_by_id);

--
-- Name: salary_adjustments_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX salary_adjustments_user_id_idx ON public.salary_adjustments USING btree (user_id);

--
-- Name: salary_bands_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX salary_bands_organization_id_idx ON public.salary_bands USING btree (organization_id);

--
-- Name: salary_bands_organization_id_level_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX salary_bands_organization_id_level_key ON public.salary_bands USING btree (organization_id, level);

--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);

--
-- Name: sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_organization_id_idx ON public.sessions USING btree (organization_id);

--
-- Name: sessions_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX sessions_token_key ON public.sessions USING btree (token);

--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);

--
-- Name: stage_movements_application_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stage_movements_application_id_idx ON public.stage_movements USING btree (application_id);

--
-- Name: stage_movements_from_stage_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stage_movements_from_stage_id_idx ON public.stage_movements USING btree (from_stage_id);

--
-- Name: stage_movements_moved_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stage_movements_moved_by_idx ON public.stage_movements USING btree (moved_by);

--
-- Name: stage_movements_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stage_movements_organization_id_idx ON public.stage_movements USING btree (organization_id);

--
-- Name: stage_movements_to_stage_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stage_movements_to_stage_id_idx ON public.stage_movements USING btree (to_stage_id);

--
-- Name: subscriptions_organization_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscriptions_organization_id_key ON public.subscriptions USING btree (organization_id);

--
-- Name: subscriptions_stripe_customer_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscriptions_stripe_customer_id_key ON public.subscriptions USING btree (stripe_customer_id);

--
-- Name: subscriptions_stripe_subscription_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscriptions_stripe_subscription_id_key ON public.subscriptions USING btree (stripe_subscription_id);

--
-- Name: successors_added_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX successors_added_by_id_idx ON public.successors USING btree (added_by_id);

--
-- Name: successors_critical_role_id_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX successors_critical_role_id_user_id_key ON public.successors USING btree (critical_role_id, user_id);

--
-- Name: successors_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX successors_organization_id_idx ON public.successors USING btree (organization_id);

--
-- Name: successors_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX successors_user_id_idx ON public.successors USING btree (user_id);

--
-- Name: survey_responses_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX survey_responses_organization_id_idx ON public.survey_responses USING btree (organization_id);

--
-- Name: survey_responses_survey_id_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX survey_responses_survey_id_user_id_key ON public.survey_responses USING btree (survey_id, user_id);

--
-- Name: survey_responses_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX survey_responses_user_id_idx ON public.survey_responses USING btree (user_id);

--
-- Name: surveys_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX surveys_created_by_id_idx ON public.surveys USING btree (created_by_id);

--
-- Name: surveys_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX surveys_organization_id_idx ON public.surveys USING btree (organization_id);

--
-- Name: sync_errors_connector_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sync_errors_connector_id_idx ON public.sync_errors USING btree (connector_id);

--
-- Name: sync_errors_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sync_errors_organization_id_idx ON public.sync_errors USING btree (organization_id);

--
-- Name: teams_business_unit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX teams_business_unit_id_idx ON public.teams USING btree (business_unit_id);

--
-- Name: teams_leader_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX teams_leader_id_idx ON public.teams USING btree (leader_id);

--
-- Name: teams_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX teams_organization_id_idx ON public.teams USING btree (organization_id);

--
-- Name: user_business_units_business_unit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_business_units_business_unit_id_idx ON public.user_business_units USING btree (business_unit_id);

--
-- Name: user_business_units_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_business_units_organization_id_idx ON public.user_business_units USING btree (organization_id);

--
-- Name: user_business_units_user_id_business_unit_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_business_units_user_id_business_unit_id_key ON public.user_business_units USING btree (user_id, business_unit_id);

--
-- Name: user_roles_role_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_roles_role_id_idx ON public.user_roles USING btree (role_id);

--
-- Name: user_roles_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_roles_user_id_idx ON public.user_roles USING btree (user_id);

--
-- Name: user_roles_user_id_role_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_roles_user_id_role_id_key ON public.user_roles USING btree (user_id, role_id);

--
-- Name: user_teams_team_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_teams_team_id_idx ON public.user_teams USING btree (team_id);

--
-- Name: user_teams_user_id_team_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_teams_user_id_team_id_key ON public.user_teams USING btree (user_id, team_id);

--
-- Name: users_business_unit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_business_unit_id_idx ON public.users USING btree (business_unit_id);

--
-- Name: users_company_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_company_id_idx ON public.users USING btree (company_id);

--
-- Name: users_organization_id_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_organization_id_email_key ON public.users USING btree (organization_id, email);

--
-- Name: users_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_organization_id_idx ON public.users USING btree (organization_id);

--
-- Name: users_supabase_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_supabase_user_id_idx ON public.users USING btree (supabase_user_id);

--
-- Name: users_supabase_user_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_supabase_user_id_key ON public.users USING btree (supabase_user_id);

--
-- Name: ux_fx_rates_base_quote_asof; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_fx_rates_base_quote_asof ON public.fx_rates USING btree (base_currency, quote_currency, as_of);

--
-- Name: ux_hris_connectors_org_provider; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_hris_connectors_org_provider ON public.hris_connectors USING btree (organization_id, provider);

--
-- Name: ux_hris_external_employees_org_connector_external; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_hris_external_employees_org_connector_external ON public.hris_external_employees USING btree (organization_id, connector_id, external_id);

--
-- Name: ux_hris_sync_runs_org_connector_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_hris_sync_runs_org_connector_idempotency ON public.hris_sync_runs USING btree (organization_id, connector_id, idempotency_key);

--
-- Name: vacancies_assigned_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_assigned_to_idx ON public.vacancies USING btree (assigned_to);

--
-- Name: vacancies_business_unit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_business_unit_id_idx ON public.vacancies USING btree (business_unit_id);

--
-- Name: vacancies_company_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_company_id_idx ON public.vacancies USING btree (company_id);

--
-- Name: vacancies_created_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_created_by_idx ON public.vacancies USING btree (created_by);

--
-- Name: vacancies_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_organization_id_idx ON public.vacancies USING btree (organization_id);

--
-- Name: vacancies_organization_id_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_organization_id_status_idx ON public.vacancies USING btree (organization_id, status);

--
-- Name: vacancies_team_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancies_team_id_idx ON public.vacancies USING btree (team_id);

--
-- Name: vacancy_approvals_approver_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancy_approvals_approver_id_idx ON public.vacancy_approvals USING btree (approver_id);

--
-- Name: vacancy_approvals_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancy_approvals_organization_id_idx ON public.vacancy_approvals USING btree (organization_id);

--
-- Name: vacancy_approvals_vacancy_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vacancy_approvals_vacancy_id_idx ON public.vacancy_approvals USING btree (vacancy_id);

--
-- Name: webhooks_created_by_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX webhooks_created_by_id_idx ON public.webhooks USING btree (created_by_id);

--
-- Name: webhooks_organization_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX webhooks_organization_id_idx ON public.webhooks USING btree (organization_id);

--
-- Name: audit_logs audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.tims_append_only_guard();

ALTER TABLE public.audit_logs ENABLE ALWAYS TRIGGER audit_logs_append_only;

--
-- Name: audit_logs audit_logs_append_only_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_logs_append_only_truncate BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.tims_append_only_guard();

ALTER TABLE public.audit_logs ENABLE ALWAYS TRIGGER audit_logs_append_only_truncate;

--
-- Name: data_access_logs data_access_logs_append_only; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER data_access_logs_append_only BEFORE DELETE OR UPDATE ON public.data_access_logs FOR EACH ROW EXECUTE FUNCTION public.tims_append_only_guard();

ALTER TABLE public.data_access_logs ENABLE ALWAYS TRIGGER data_access_logs_append_only;

--
-- Name: data_access_logs data_access_logs_append_only_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER data_access_logs_append_only_truncate BEFORE TRUNCATE ON public.data_access_logs FOR EACH STATEMENT EXECUTE FUNCTION public.tims_append_only_guard();

ALTER TABLE public.data_access_logs ENABLE ALWAYS TRIGGER data_access_logs_append_only_truncate;

--
-- Name: access_reviews access_reviews_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_reviews
    ADD CONSTRAINT access_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: access_reviews access_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_reviews
    ADD CONSTRAINT access_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: action_plans action_plans_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_plans
    ADD CONSTRAINT action_plans_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: ai_agent_org_configs ai_agent_org_configs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agent_org_configs
    ADD CONSTRAINT ai_agent_org_configs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.ai_agents(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: ai_agent_org_configs ai_agent_org_configs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agent_org_configs
    ADD CONSTRAINT ai_agent_org_configs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: ai_agent_usage_logs ai_agent_usage_logs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_agent_usage_logs
    ADD CONSTRAINT ai_agent_usage_logs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.ai_agents(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: ai_interview_sessions ai_interview_sessions_interview_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: ai_interview_sessions ai_interview_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: alert_rules alert_rules_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: alerts alerts_dismissed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_dismissed_by_id_fkey FOREIGN KEY (dismissed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: alerts alerts_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: api_keys api_keys_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: applications applications_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: applications applications_current_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_current_stage_id_fkey FOREIGN KEY (current_stage_id) REFERENCES public.pipeline_stages(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: applications applications_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: assessment_assignments assessment_assignments_assessment_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_assignments
    ADD CONSTRAINT assessment_assignments_assessment_type_id_fkey FOREIGN KEY (assessment_type_id) REFERENCES public.assessment_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: assessment_assignments assessment_assignments_assigned_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_assignments
    ADD CONSTRAINT assessment_assignments_assigned_by_id_fkey FOREIGN KEY (assigned_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: assessment_assignments assessment_assignments_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_assignments
    ADD CONSTRAINT assessment_assignments_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: assessment_assignments assessment_assignments_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_assignments
    ADD CONSTRAINT assessment_assignments_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: assessment_consents assessment_consents_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_consents
    ADD CONSTRAINT assessment_consents_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assessment_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: assessment_questions assessment_questions_assessment_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_assessment_type_id_fkey FOREIGN KEY (assessment_type_id) REFERENCES public.assessment_types(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: assessment_responses assessment_responses_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assessment_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: assessment_responses assessment_responses_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.assessment_questions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: assessment_results assessment_results_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assessment_assignments(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: benefit_enrollments benefit_enrollments_benefit_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.benefit_enrollments
    ADD CONSTRAINT benefit_enrollments_benefit_plan_id_fkey FOREIGN KEY (benefit_plan_id) REFERENCES public.benefit_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: benefit_enrollments benefit_enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.benefit_enrollments
    ADD CONSTRAINT benefit_enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: billing_profiles billing_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.billing_profiles
    ADD CONSTRAINT billing_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: business_units business_units_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: business_units business_units_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.business_units(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: calibration_members calibration_members_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_members
    ADD CONSTRAINT calibration_members_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.calibration_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: calibration_members calibration_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_members
    ADD CONSTRAINT calibration_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: calibration_sessions calibration_sessions_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_sessions
    ADD CONSTRAINT calibration_sessions_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: calibration_votes calibration_votes_evaluated_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_votes
    ADD CONSTRAINT calibration_votes_evaluated_user_id_fkey FOREIGN KEY (evaluated_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: calibration_votes calibration_votes_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_votes
    ADD CONSTRAINT calibration_votes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.calibration_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: calibration_votes calibration_votes_voter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calibration_votes
    ADD CONSTRAINT calibration_votes_voter_id_fkey FOREIGN KEY (voter_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: candidate_documents candidate_documents_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidate_documents
    ADD CONSTRAINT candidate_documents_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: candidate_tags candidate_tags_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidate_tags
    ADD CONSTRAINT candidate_tags_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: candidates candidates_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: certificates certificates_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: certificates certificates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: coaching_sessions coaching_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: coaching_sessions coaching_sessions_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: commitments commitments_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commitments
    ADD CONSTRAINT commitments_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: commitments commitments_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commitments
    ADD CONSTRAINT commitments_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: commitments commitments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commitments
    ADD CONSTRAINT commitments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: companies companies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: connector_syncs connector_syncs_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_syncs
    ADD CONSTRAINT connector_syncs_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES public.connectors(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: connectors connectors_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connectors
    ADD CONSTRAINT connectors_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: courses courses_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: critical_roles critical_roles_current_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.critical_roles
    ADD CONSTRAINT critical_roles_current_holder_id_fkey FOREIGN KEY (current_holder_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: employee_compensations employee_compensations_band_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_compensations
    ADD CONSTRAINT employee_compensations_band_id_fkey FOREIGN KEY (band_id) REFERENCES public.salary_bands(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: employee_compensations employee_compensations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_compensations
    ADD CONSTRAINT employee_compensations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: employee_demographics employee_demographics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_demographics
    ADD CONSTRAINT employee_demographics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: enrollments enrollments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: enrollments enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: feature_flags feature_flags_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: feedbacks feedbacks_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feedbacks
    ADD CONSTRAINT feedbacks_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: feedbacks feedbacks_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feedbacks
    ADD CONSTRAINT feedbacks_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: fit_scores fit_scores_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fit_scores
    ADD CONSTRAINT fit_scores_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fit_scores fit_scores_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fit_scores
    ADD CONSTRAINT fit_scores_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: hire_predictions hire_predictions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: hire_predictions hire_predictions_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: hire_predictions hire_predictions_hired_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_hired_by_id_fkey FOREIGN KEY (hired_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: hire_predictions hire_predictions_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: hire_predictions hire_predictions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: hire_predictions hire_predictions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: hire_predictions hire_predictions_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hire_predictions
    ADD CONSTRAINT hire_predictions_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: interview_evaluators interview_evaluators_interview_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_evaluators
    ADD CONSTRAINT interview_evaluators_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: interview_evaluators interview_evaluators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_evaluators
    ADD CONSTRAINT interview_evaluators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: interview_scorecards interview_scorecards_evaluator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_scorecards
    ADD CONSTRAINT interview_scorecards_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: interview_scorecards interview_scorecards_interview_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_scorecards
    ADD CONSTRAINT interview_scorecards_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: interview_summaries interview_summaries_interview_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interview_summaries
    ADD CONSTRAINT interview_summaries_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: interviews interviews_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: interviews interviews_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: interviews interviews_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: interviews interviews_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: invoice_line_items invoice_line_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: invoices invoices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: invoices invoices_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: job_profiles job_profiles_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_profiles
    ADD CONSTRAINT job_profiles_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: key_results key_results_okr_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_okr_id_fkey FOREIGN KEY (okr_id) REFERENCES public.okrs(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: leader_commitments leader_commitments_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leader_commitments
    ADD CONSTRAINT leader_commitments_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: learning_path_courses learning_path_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_path_courses
    ADD CONSTRAINT learning_path_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: learning_path_courses learning_path_courses_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_path_courses
    ADD CONSTRAINT learning_path_courses_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.learning_paths(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: legal_checks legal_checks_completed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_checks
    ADD CONSTRAINT legal_checks_completed_by_id_fkey FOREIGN KEY (completed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: legal_checks legal_checks_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_checks
    ADD CONSTRAINT legal_checks_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: nine_box_evaluations nine_box_evaluations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nine_box_evaluations
    ADD CONSTRAINT nine_box_evaluations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: offer_approvals offer_approvals_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_approvals
    ADD CONSTRAINT offer_approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: offer_approvals offer_approvals_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_approvals
    ADD CONSTRAINT offer_approvals_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: offers offers_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: offers offers_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: offers offers_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: offers offers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: offers offers_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: okrs okrs_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: okrs okrs_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: okrs okrs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: onboarding_check_ins onboarding_check_ins_completed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_check_ins
    ADD CONSTRAINT onboarding_check_ins_completed_by_id_fkey FOREIGN KEY (completed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: onboarding_check_ins onboarding_check_ins_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_check_ins
    ADD CONSTRAINT onboarding_check_ins_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.onboarding_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: onboarding_plans onboarding_plans_buddy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_buddy_id_fkey FOREIGN KEY (buddy_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: onboarding_plans onboarding_plans_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: onboarding_plans onboarding_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: onboarding_tasks onboarding_tasks_completed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_tasks
    ADD CONSTRAINT onboarding_tasks_completed_by_id_fkey FOREIGN KEY (completed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: onboarding_tasks onboarding_tasks_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_tasks
    ADD CONSTRAINT onboarding_tasks_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.onboarding_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: org_entitlements org_entitlements_module_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org_entitlements
    ADD CONSTRAINT org_entitlements_module_code_fkey FOREIGN KEY (module_code) REFERENCES public.modules(code) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: org_entitlements org_entitlements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org_entitlements
    ADD CONSTRAINT org_entitlements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: pipeline_stages pipeline_stages_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: plan_modules plan_modules_module_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_modules
    ADD CONSTRAINT plan_modules_module_code_fkey FOREIGN KEY (module_code) REFERENCES public.modules(code) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: plan_modules plan_modules_plan_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_modules
    ADD CONSTRAINT plan_modules_plan_code_fkey FOREIGN KEY (plan_code) REFERENCES public.plans(code) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: platform_invitations platform_invitations_invited_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_invited_by_id_fkey FOREIGN KEY (invited_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: platform_invitations platform_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: preemployment_validations preemployment_validations_completed_by_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.preemployment_validations
    ADD CONSTRAINT preemployment_validations_completed_by_api_key_id_fkey FOREIGN KEY (completed_by_api_key_id) REFERENCES public.api_keys(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: preemployment_validations preemployment_validations_completed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.preemployment_validations
    ADD CONSTRAINT preemployment_validations_completed_by_id_fkey FOREIGN KEY (completed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: preemployment_validations preemployment_validations_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.preemployment_validations
    ADD CONSTRAINT preemployment_validations_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: proctoring_sessions proctoring_sessions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proctoring_sessions
    ADD CONSTRAINT proctoring_sessions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assessment_assignments(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: publication_channels publication_channels_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.publication_channels
    ADD CONSTRAINT publication_channels_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: qrtz_blob_triggers qrtz_blob_triggers_sched_name_trigger_name_trigger_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_blob_triggers
    ADD CONSTRAINT qrtz_blob_triggers_sched_name_trigger_name_trigger_group_fkey FOREIGN KEY (sched_name, trigger_name, trigger_group) REFERENCES public.qrtz_triggers(sched_name, trigger_name, trigger_group) ON DELETE CASCADE;

--
-- Name: qrtz_cron_triggers qrtz_cron_triggers_sched_name_trigger_name_trigger_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_cron_triggers
    ADD CONSTRAINT qrtz_cron_triggers_sched_name_trigger_name_trigger_group_fkey FOREIGN KEY (sched_name, trigger_name, trigger_group) REFERENCES public.qrtz_triggers(sched_name, trigger_name, trigger_group) ON DELETE CASCADE;

--
-- Name: qrtz_simple_triggers qrtz_simple_triggers_sched_name_trigger_name_trigger_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_simple_triggers
    ADD CONSTRAINT qrtz_simple_triggers_sched_name_trigger_name_trigger_group_fkey FOREIGN KEY (sched_name, trigger_name, trigger_group) REFERENCES public.qrtz_triggers(sched_name, trigger_name, trigger_group) ON DELETE CASCADE;

--
-- Name: qrtz_simprop_triggers qrtz_simprop_triggers_sched_name_trigger_name_trigger_grou_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_simprop_triggers
    ADD CONSTRAINT qrtz_simprop_triggers_sched_name_trigger_name_trigger_grou_fkey FOREIGN KEY (sched_name, trigger_name, trigger_group) REFERENCES public.qrtz_triggers(sched_name, trigger_name, trigger_group) ON DELETE CASCADE;

--
-- Name: qrtz_triggers qrtz_triggers_sched_name_job_name_job_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qrtz_triggers
    ADD CONSTRAINT qrtz_triggers_sched_name_job_name_job_group_fkey FOREIGN KEY (sched_name, job_name, job_group) REFERENCES public.qrtz_job_details(sched_name, job_name, job_group);

--
-- Name: rater_assignments rater_assignments_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_assignments
    ADD CONSTRAINT rater_assignments_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.review_cycles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: rater_assignments rater_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_assignments
    ADD CONSTRAINT rater_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: rater_assignments rater_assignments_rater_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_assignments
    ADD CONSTRAINT rater_assignments_rater_user_id_fkey FOREIGN KEY (rater_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: rater_assignments rater_assignments_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_assignments
    ADD CONSTRAINT rater_assignments_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: rater_responses rater_responses_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_responses
    ADD CONSTRAINT rater_responses_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.rater_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: rater_responses rater_responses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rater_responses
    ADD CONSTRAINT rater_responses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: recognitions recognitions_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recognitions
    ADD CONSTRAINT recognitions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: recognitions recognitions_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recognitions
    ADD CONSTRAINT recognitions_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: referrals referrals_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: review_cycles review_cycles_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.review_cycles
    ADD CONSTRAINT review_cycles_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: review_cycles review_cycles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.review_cycles
    ADD CONSTRAINT review_cycles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: role_family_weight_profiles role_family_weight_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_family_weight_profiles
    ADD CONSTRAINT role_family_weight_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: roles roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: salary_adjustments salary_adjustments_approved_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_adjustments
    ADD CONSTRAINT salary_adjustments_approved_by_id_fkey FOREIGN KEY (approved_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: salary_adjustments salary_adjustments_requested_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_adjustments
    ADD CONSTRAINT salary_adjustments_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: salary_adjustments salary_adjustments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_adjustments
    ADD CONSTRAINT salary_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: stage_movements stage_movements_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_movements
    ADD CONSTRAINT stage_movements_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: stage_movements stage_movements_from_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_movements
    ADD CONSTRAINT stage_movements_from_stage_id_fkey FOREIGN KEY (from_stage_id) REFERENCES public.pipeline_stages(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: stage_movements stage_movements_moved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_movements
    ADD CONSTRAINT stage_movements_moved_by_fkey FOREIGN KEY (moved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: stage_movements stage_movements_to_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_movements
    ADD CONSTRAINT stage_movements_to_stage_id_fkey FOREIGN KEY (to_stage_id) REFERENCES public.pipeline_stages(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: subscriptions subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: successors successors_added_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.successors
    ADD CONSTRAINT successors_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: successors successors_critical_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.successors
    ADD CONSTRAINT successors_critical_role_id_fkey FOREIGN KEY (critical_role_id) REFERENCES public.critical_roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: successors successors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.successors
    ADD CONSTRAINT successors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: survey_responses survey_responses_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: survey_responses survey_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: surveys surveys_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: sync_errors sync_errors_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sync_errors
    ADD CONSTRAINT sync_errors_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES public.connectors(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: teams teams_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: teams teams_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: user_business_units user_business_units_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_business_units
    ADD CONSTRAINT user_business_units_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_business_units user_business_units_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_business_units
    ADD CONSTRAINT user_business_units_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_teams user_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_teams user_teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: vacancies vacancies_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: vacancies vacancies_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: vacancies vacancies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: vacancies vacancies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: vacancies vacancies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: vacancies vacancies_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: vacancy_approvals vacancy_approvals_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancy_approvals
    ADD CONSTRAINT vacancy_approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: vacancy_approvals vacancy_approvals_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vacancy_approvals
    ADD CONSTRAINT vacancy_approvals_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: webhooks webhooks_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: access_reviews; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.access_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: action_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.action_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_agent_org_configs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_agent_org_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_agent_usage_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_agent_usage_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_interview_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: alert_rules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: alerts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions allow_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY allow_all ON public.permissions USING (true);

--
-- Name: platform_owner_emails allow_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY allow_all ON public.platform_owner_emails USING (true);

--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: applications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_assignments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_consents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_questions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_results; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_results ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_types; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: benefit_enrollments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.benefit_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: benefit_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.benefit_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: business_units; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

--
-- Name: calibration_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.calibration_members ENABLE ROW LEVEL SECURITY;

--
-- Name: calibration_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.calibration_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: calibration_votes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.calibration_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_documents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.candidate_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_tags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.candidate_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: candidates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: certificates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.coaching_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: commitments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_syncs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_syncs ENABLE ROW LEVEL SECURITY;

--
-- Name: connectors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: critical_roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.critical_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: data_access_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.data_access_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: data_consents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.data_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_compensations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.employee_compensations ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_demographics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.employee_demographics ENABLE ROW LEVEL SECURITY;

--
-- Name: enrollments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_flags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: feedbacks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

--
-- Name: fit_scores; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fit_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: hire_predictions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hire_predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: hris_connectors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hris_connectors ENABLE ROW LEVEL SECURITY;

--
-- Name: hris_external_employees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hris_external_employees ENABLE ROW LEVEL SECURITY;

--
-- Name: hris_sync_record_errors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hris_sync_record_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: hris_sync_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hris_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_evaluators; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.interview_evaluators ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_scorecards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.interview_scorecards ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_summaries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.interview_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: interviews; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_line_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: job_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.job_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: key_results; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.key_results ENABLE ROW LEVEL SECURITY;

--
-- Name: leader_commitments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.leader_commitments ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_path_courses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.learning_path_courses ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_paths; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_checks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.legal_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: nine_box_evaluations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.nine_box_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_approvals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.offer_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: offers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

--
-- Name: okrs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.okrs ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_check_ins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.onboarding_check_ins ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.onboarding_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_tasks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.onboarding_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: org_entitlements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.org_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_owner_emails; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.platform_owner_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: preemployment_validations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.preemployment_validations ENABLE ROW LEVEL SECURITY;

--
-- Name: proctoring_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.proctoring_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: publication_channels; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.publication_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: rater_assignments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rater_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: rater_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rater_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: recognitions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.recognitions ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: review_cycles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.review_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: role_family_weight_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.role_family_weight_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: salary_adjustments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.salary_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: salary_bands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.salary_bands ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: stage_movements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stage_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: successors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.successors ENABLE ROW LEVEL SECURITY;

--
-- Name: survey_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: surveys; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_errors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sync_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: access_reviews tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.access_reviews USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: action_plans tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.action_plans USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: ai_agent_org_configs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.ai_agent_org_configs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: ai_agent_usage_logs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.ai_agent_usage_logs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: ai_interview_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.ai_interview_sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: alert_rules tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.alert_rules USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: alerts tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.alerts USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: api_keys tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.api_keys USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: applications tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.applications USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_assignments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_consents tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_consents USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_questions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_questions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_responses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_responses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_results tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_results USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: assessment_types tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.assessment_types USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: audit_logs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.audit_logs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: benefit_enrollments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.benefit_enrollments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: benefit_plans tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.benefit_plans USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: billing_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.billing_profiles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: business_units tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.business_units USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: calibration_members tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.calibration_members USING ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_members.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_members.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: calibration_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.calibration_sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: calibration_votes tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.calibration_votes USING ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_votes.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_votes.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: candidate_documents tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.candidate_documents USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: candidate_tags tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.candidate_tags USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: candidates tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.candidates USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: certificates tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.certificates USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: coaching_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.coaching_sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: commitments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.commitments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: companies tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.companies USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: connector_syncs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.connector_syncs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: connectors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.connectors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: courses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.courses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: critical_roles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.critical_roles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: data_access_logs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.data_access_logs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: data_consents tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.data_consents USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: employee_compensations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.employee_compensations USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: employee_demographics tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.employee_demographics USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: enrollments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.enrollments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: feature_flags tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.feature_flags USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: feedbacks tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.feedbacks USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: fit_scores tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.fit_scores USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: hire_predictions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.hire_predictions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: hris_connectors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.hris_connectors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: hris_external_employees tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.hris_external_employees USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: hris_sync_record_errors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.hris_sync_record_errors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: hris_sync_runs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.hris_sync_runs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: interview_evaluators tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.interview_evaluators USING ((EXISTS ( SELECT 1
   FROM public.interviews par
  WHERE ((par.id = interview_evaluators.interview_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews par
  WHERE ((par.id = interview_evaluators.interview_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: interview_scorecards tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.interview_scorecards USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: interview_summaries tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.interview_summaries USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: interviews tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.interviews USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: invoice_line_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.invoice_line_items USING ((EXISTS ( SELECT 1
   FROM public.invoices par
  WHERE ((par.id = invoice_line_items.invoice_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.invoices par
  WHERE ((par.id = invoice_line_items.invoice_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: invoices tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.invoices USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: job_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.job_profiles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: key_results tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.key_results USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: leader_commitments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.leader_commitments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: learning_path_courses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.learning_path_courses USING ((EXISTS ( SELECT 1
   FROM public.learning_paths par
  WHERE ((par.id = learning_path_courses.path_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.learning_paths par
  WHERE ((par.id = learning_path_courses.path_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: learning_paths tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.learning_paths USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: legal_checks tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.legal_checks USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: nine_box_evaluations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.nine_box_evaluations USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: notification_preferences tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.notification_preferences USING ((EXISTS ( SELECT 1
   FROM public.users par
  WHERE ((par.id = notification_preferences.user_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users par
  WHERE ((par.id = notification_preferences.user_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.notifications USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: offer_approvals tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.offer_approvals USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: offers tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.offers USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: okrs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.okrs USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: onboarding_check_ins tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.onboarding_check_ins USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: onboarding_plans tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.onboarding_plans USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: onboarding_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.onboarding_tasks USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: org_entitlements tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.org_entitlements USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: organizations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.organizations USING ((id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: pipeline_stages tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.pipeline_stages USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: platform_invitations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.platform_invitations USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: preemployment_validations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.preemployment_validations USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: proctoring_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.proctoring_sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: publication_channels tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.publication_channels USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: rater_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.rater_assignments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: rater_responses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.rater_responses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: recognitions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.recognitions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: referrals tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.referrals USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: review_cycles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.review_cycles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: role_family_weight_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.role_family_weight_profiles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: role_permissions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.role_permissions USING ((EXISTS ( SELECT 1
   FROM public.roles par
  WHERE ((par.id = role_permissions.role_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.roles par
  WHERE ((par.id = role_permissions.role_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: roles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.roles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: salary_adjustments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.salary_adjustments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: salary_bands tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.salary_bands USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: stage_movements tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.stage_movements USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: subscriptions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.subscriptions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: successors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.successors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: survey_responses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.survey_responses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: surveys tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.surveys USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: sync_errors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.sync_errors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: teams tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.teams USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: user_business_units tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.user_business_units USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: user_roles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.user_roles USING ((EXISTS ( SELECT 1
   FROM public.roles par
  WHERE ((par.id = user_roles.role_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.roles par
  WHERE ((par.id = user_roles.role_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: user_teams tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.user_teams USING ((EXISTS ( SELECT 1
   FROM public.teams par
  WHERE ((par.id = user_teams.team_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teams par
  WHERE ((par.id = user_teams.team_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.users USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: vacancies tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.vacancies USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: vacancy_approvals tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.vacancy_approvals USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: webhooks tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.webhooks USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

--
-- Name: user_business_units; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_business_units ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_teams; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vacancies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;

--
-- Name: vacancy_approvals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.vacancy_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: webhooks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_tenant;

--
-- Name: TABLE "__EFMigrationsHistory"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."__EFMigrationsHistory" TO app_tenant;

--
-- Name: TABLE access_reviews; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.access_reviews TO app_tenant;

--
-- Name: TABLE action_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.action_plans TO app_tenant;

--
-- Name: TABLE ai_agent_org_configs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_agent_org_configs TO app_tenant;

--
-- Name: TABLE ai_agent_usage_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_agent_usage_logs TO app_tenant;

--
-- Name: TABLE ai_agents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_agents TO app_tenant;

--
-- Name: TABLE ai_interview_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_interview_sessions TO app_tenant;

--
-- Name: TABLE alert_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alert_rules TO app_tenant;

--
-- Name: TABLE alerts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alerts TO app_tenant;

--
-- Name: TABLE api_keys; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.api_keys TO app_tenant;

--
-- Name: TABLE applications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.applications TO app_tenant;

--
-- Name: TABLE assessment_assignments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_assignments TO app_tenant;

--
-- Name: TABLE assessment_consents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_consents TO app_tenant;

--
-- Name: TABLE assessment_questions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_questions TO app_tenant;

--
-- Name: TABLE assessment_responses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_responses TO app_tenant;

--
-- Name: TABLE assessment_results; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_results TO app_tenant;

--
-- Name: TABLE assessment_types; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_types TO app_tenant;

--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.audit_logs TO app_tenant;

--
-- Name: TABLE benefit_enrollments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.benefit_enrollments TO app_tenant;

--
-- Name: TABLE benefit_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.benefit_plans TO app_tenant;

--
-- Name: TABLE billing_profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.billing_profiles TO app_tenant;

--
-- Name: TABLE business_units; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_units TO app_tenant;

--
-- Name: TABLE calibration_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_members TO app_tenant;

--
-- Name: TABLE calibration_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_sessions TO app_tenant;

--
-- Name: TABLE calibration_votes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_votes TO app_tenant;

--
-- Name: TABLE candidate_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.candidate_documents TO app_tenant;

--
-- Name: TABLE candidate_tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.candidate_tags TO app_tenant;

--
-- Name: TABLE candidates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.candidates TO app_tenant;

--
-- Name: TABLE certificates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.certificates TO app_tenant;

--
-- Name: TABLE coaching_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coaching_sessions TO app_tenant;

--
-- Name: TABLE commitments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commitments TO app_tenant;

--
-- Name: TABLE companies; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.companies TO app_tenant;

--
-- Name: TABLE connector_syncs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_syncs TO app_tenant;

--
-- Name: TABLE connectors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connectors TO app_tenant;

--
-- Name: TABLE courses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.courses TO app_tenant;

--
-- Name: TABLE critical_roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.critical_roles TO app_tenant;

--
-- Name: TABLE data_access_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.data_access_logs TO app_tenant;

--
-- Name: TABLE data_consents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_consents TO app_tenant;

--
-- Name: TABLE employee_compensations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employee_compensations TO app_tenant;

--
-- Name: TABLE employee_demographics; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employee_demographics TO app_tenant;

--
-- Name: TABLE enrollments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.enrollments TO app_tenant;

--
-- Name: TABLE feature_flags; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feature_flags TO app_tenant;

--
-- Name: TABLE feedbacks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feedbacks TO app_tenant;

--
-- Name: TABLE fit_scores; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fit_scores TO app_tenant;

--
-- Name: TABLE fx_rates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fx_rates TO app_tenant;

--
-- Name: TABLE hire_predictions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hire_predictions TO app_tenant;

--
-- Name: TABLE hris_connectors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hris_connectors TO app_tenant;

--
-- Name: TABLE hris_external_employees; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hris_external_employees TO app_tenant;

--
-- Name: TABLE hris_sync_record_errors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hris_sync_record_errors TO app_tenant;

--
-- Name: TABLE hris_sync_runs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hris_sync_runs TO app_tenant;

--
-- Name: TABLE interview_evaluators; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.interview_evaluators TO app_tenant;

--
-- Name: TABLE interview_scorecards; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.interview_scorecards TO app_tenant;

--
-- Name: TABLE interview_summaries; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.interview_summaries TO app_tenant;

--
-- Name: TABLE interviews; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.interviews TO app_tenant;

--
-- Name: TABLE invoice_line_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoice_line_items TO app_tenant;

--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoices TO app_tenant;

--
-- Name: SEQUENCE invoices_invoice_number_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.invoices_invoice_number_seq TO app_tenant;

--
-- Name: TABLE job_profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_profiles TO app_tenant;

--
-- Name: TABLE key_results; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.key_results TO app_tenant;

--
-- Name: TABLE leader_commitments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leader_commitments TO app_tenant;

--
-- Name: TABLE learning_path_courses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.learning_path_courses TO app_tenant;

--
-- Name: TABLE learning_paths; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.learning_paths TO app_tenant;

--
-- Name: TABLE legal_checks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.legal_checks TO app_tenant;

--
-- Name: TABLE modules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.modules TO app_tenant;

--
-- Name: TABLE nine_box_evaluations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.nine_box_evaluations TO app_tenant;

--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_preferences TO app_tenant;

--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO app_tenant;

--
-- Name: TABLE offer_approvals; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.offer_approvals TO app_tenant;

--
-- Name: TABLE offers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.offers TO app_tenant;

--
-- Name: TABLE okrs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.okrs TO app_tenant;

--
-- Name: TABLE onboarding_check_ins; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_check_ins TO app_tenant;

--
-- Name: TABLE onboarding_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_plans TO app_tenant;

--
-- Name: TABLE onboarding_tasks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_tasks TO app_tenant;

--
-- Name: TABLE org_entitlements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.org_entitlements TO app_tenant;

--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organizations TO app_tenant;

--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permissions TO app_tenant;

--
-- Name: TABLE pipeline_stages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pipeline_stages TO app_tenant;

--
-- Name: TABLE plan_modules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plan_modules TO app_tenant;

--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plans TO app_tenant;

--
-- Name: TABLE platform_invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_invitations TO app_tenant;

--
-- Name: TABLE platform_owner_emails; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_owner_emails TO app_tenant;

--
-- Name: TABLE preemployment_validations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.preemployment_validations TO app_tenant;

--
-- Name: TABLE proctoring_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proctoring_sessions TO app_tenant;

--
-- Name: TABLE publication_channels; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.publication_channels TO app_tenant;

--
-- Name: TABLE qrtz_blob_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_blob_triggers TO app_tenant;

--
-- Name: TABLE qrtz_calendars; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_calendars TO app_tenant;

--
-- Name: TABLE qrtz_cron_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_cron_triggers TO app_tenant;

--
-- Name: TABLE qrtz_fired_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_fired_triggers TO app_tenant;

--
-- Name: TABLE qrtz_job_details; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_job_details TO app_tenant;

--
-- Name: TABLE qrtz_locks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_locks TO app_tenant;

--
-- Name: TABLE qrtz_paused_trigger_grps; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_paused_trigger_grps TO app_tenant;

--
-- Name: TABLE qrtz_scheduler_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_scheduler_state TO app_tenant;

--
-- Name: TABLE qrtz_simple_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_simple_triggers TO app_tenant;

--
-- Name: TABLE qrtz_simprop_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_simprop_triggers TO app_tenant;

--
-- Name: TABLE qrtz_triggers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qrtz_triggers TO app_tenant;

--
-- Name: TABLE rater_assignments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rater_assignments TO app_tenant;

--
-- Name: TABLE rater_responses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rater_responses TO app_tenant;

--
-- Name: TABLE recognitions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recognitions TO app_tenant;

--
-- Name: TABLE referrals; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.referrals TO app_tenant;

--
-- Name: TABLE review_cycles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_cycles TO app_tenant;

--
-- Name: TABLE role_family_weight_profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_family_weight_profiles TO app_tenant;

--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO app_tenant;

--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO app_tenant;

--
-- Name: TABLE salary_adjustments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.salary_adjustments TO app_tenant;

--
-- Name: TABLE salary_bands; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.salary_bands TO app_tenant;

--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO app_tenant;

--
-- Name: TABLE stage_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stage_movements TO app_tenant;

--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscriptions TO app_tenant;

--
-- Name: TABLE successors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.successors TO app_tenant;

--
-- Name: TABLE survey_responses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.survey_responses TO app_tenant;

--
-- Name: TABLE surveys; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.surveys TO app_tenant;

--
-- Name: TABLE sync_errors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sync_errors TO app_tenant;

--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teams TO app_tenant;

--
-- Name: TABLE user_business_units; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_business_units TO app_tenant;

--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_roles TO app_tenant;

--
-- Name: TABLE user_teams; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_teams TO app_tenant;

--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO app_tenant;

--
-- Name: TABLE vacancies; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.vacancies TO app_tenant;

--
-- Name: TABLE vacancy_approvals; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.vacancy_approvals TO app_tenant;

--
-- Name: TABLE webhooks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.webhooks TO app_tenant;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO app_tenant;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_tenant;

--
-- PostgreSQL database dump complete
--

\unrestrict <nonce-normalised>

