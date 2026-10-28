--
-- PostgreSQL database dump
--

\restrict FIXTURE_NONCE

-- Dumped from database version 17.10 (Homebrew)
-- Dumped by pg_dump version 17.10 (Homebrew)

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: f(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f() RETURNS integer
    LANGUAGE sql
    AS $$SELECT 1$$;


ALTER FUNCTION public.f() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: t; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.t (
    id uuid NOT NULL,
    a text
);


ALTER TABLE public.t OWNER TO postgres;

--
-- Name: TABLE t; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.t TO app_tenant;


--
-- PostgreSQL database dump complete
--

\unrestrict FIXTURE_NONCE

