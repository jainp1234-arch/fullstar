# FullStar – original prompts

The prompts Atul gave Claude to create the FullStar documents, in order and word for word (spelling kept as typed).
Short answers such as "ok" or "1 ok 2 yes" reply to numbered question lists Claude asked at that point; the decisions they produced are summarised under each document.

> PRD v1 and Tech Stack v1 were created in an earlier conversation that is not available here. Their original prompts are not included.

---

## 0. Finding the earlier work

> I worked with you on ai tutor . guide me to that chat and documentation

---

## 1. Tech Stack – free prototype swaps (Tech Stack v1.1)

> For now, use only free tools and account until we finalize the application. Suggest the swipes in Tech stack document first. Dont update anything yet

> PostgresSQL use neon for now. can we use vercel and cleark for now

> I will go with original swaps as of now

> ok

**Decided:** free prototype stack (Neon, Cloudflare R2, Keycloak, Docker locally, Oracle Always Free demo); Vercel and Clerk rejected; AWS stays the launch plan.

---

## 2. PRD – book or chapter-wise upload (PRD v1.1)

> also in PRD, you need to give user option to upload books or chapterwise content

**Decided:** parents can upload a whole book or add chapters one at a time.

---

## 3. App Flow (App Flow v1)

> Now I want to create the - App Flow document- a complete map of every screen, page and user journey in the application. Before you write anything, I want you ask me questions about navigation structure, page content, and user journeys that PRD does not fully answer.
> Focus on navigation patterns, how users move between sections, what a page looks like when there is no data yet, error states, ... and all considerations to define a perfect user flow.
> Ask everything you need to create this document in layman language. Do not start writing yet.

Answers to Claude's questions:

> signup mandatory, mobile number with otp,  only english for now, no payment for now, yes
> yes, no, ok, yes, no
> yes, ok,ok,no need,ok,
> ok,yes,no plan only worksheet in each subjects, no need of streak, fun, yes
> let them complete with overlimit reminder, no need
> Remaining section I will do in a while

> 1. sign in and signup two options
> 2. yes 3. yes 4 yes 5 drop 17 rest is ok 6. an indicator turning green to red will be fine.
>
> F. 24. if no book is added grammer exercise for that grade level should come in english and hindi and maths. 25.  ok 26. no need 27 only one book per subject is allowed for now
>
> 28. ok 29 no need only app 30. yes
>
> 31 generated worksheet, practice tables, saved lessons, already animated lesson by user 32 ok 33 skip for now dont assess if you dont understand and give error message to try again 34 ok 35 no payment 36 ok
> 37 ok 38 ok 39 ok 40 not mandatory but solutions should be available to verify the child attempt. parent can tick weak spots onlist
> 41 not now 42 not now
>
> 43. no one login is fine 44. ok 45. no 46 move to next class old progress can be wiped off 47 not now

> 1. no need of booklist only subjects appropriate for that class
> 2. ok 3 ok 4 generic evs concept for that class leave computer for now
>
> L. 48 ok 49 for now same teacher can do 50 ok
> 51 yes 52 ok with areas to work on 53 ok

Follow-up changes:

> no animated lessons should be for grammar topics as well as uploaded chapter so that children can learn better

> middle option. file size keep it a common standard as of now

> I believe it is still to be done from admin account with claude. May be at the start of session or account, we can ask parents to upload books. This will send notification to admin app. which can create lessons questions which can be shuffled and create worksheets as per kids practice topic or chapter parent selects

> with claude it should be quick. addiionally we can create some agent which will examine content created by app and analyse it for all red flags and still keep parents review advisable on app

> ok

**Decided:** sign in / sign up; English UI only; no payments; kid mode with 3 tabs (Learn, Practice, Read), no daily plan or streaks; no child PIN; one book per subject; grade-level content when no book; time indicator green → red, never locks; in-app messages only; admin prepares lessons from uploads with Claude; content-check agent; parent preview recommended; upload limits PDF 50 MB / 300 pages, photos 10 MB / 50 per upload. PRD and Tech Stack updated to v1.2 to match.

---

## 4. Tech Stack – locked versions (Tech Stack v2.0)

> Use the tech stack document already prepared, upversion it and  locks every dependency to an exact version number. This document will be an input document for claude code to build.
> Do not recommend any library that is less than 2 years old or has fewer than 10,000 GitHub stars unless there is no well-established alternative. I want maximum Claude Code compatibility — established, widely-used libraries only.
>  Before you make the doc, Ask me if you have any questions.

Answers chosen: **Angular 22** · **Spring Boot 4.1** · **Real free tiers** (Cloudflare R2 + AWS SQS) · **AI4Bharat Indic-TTS**

> 1 ok 2 use email otp 3. ok

**Decided:** every dependency pinned; sign-in by email one-time code (Keycloak + Brevo) instead of SMS.

---

## 5. Content Guidelines (Content Guidelines v1.0)

> NOw after building the PRD, and tech stack document, for my application I want to create a Content Guidelines document that will serve as the design system for the entire application. This document will be used by Claude Code to build every UI component and page in the application. It needs to be precise enough that the agent can implement it without making any design decisions on its own. I have added screenshot of an application. I want my UI to look like this.
> Before you prepare this document ask me if you have any questions.

(Attached: 3 reference screenshots of another learning app, used for visual style only.)

Answers chosen: **Friendly owl** mascot · space theme on the **whole app** · **Poppins** · **star counter pill in header** · **open-source icon set now** (Fluent Emoji 3D + Material Symbols) · **no dark mode** · **include writing rules** · **phone portrait first**

### Mock screens

> prepare same 3 mock screen from content design document

> looks good

---

## 6. Backend Schema (Backend Schema v1.0)

> I now need to design the complete Backend Schema for this application. This includes every database table, all relationships, authentication and authorisation flows, key API endpoints, and any database functions or triggers. Before you write anything, ask me every question you need answered to design a schema that correctly serves all the features in the PRD and all the screens in the App Flow.

> all recommendations fine

---

## 7. Implementation Plan (Implementation Plan v1.0)

> I need to create a complete Implementation Plan — a sequenced, step-by-step build plan that Claude Code will follow to build this application from initialisation to deployment. Before writing the plan, ask me any questions you need to make the sequencing correct and complete.

> ok

---

## 8. Product name

> have you decided the name of application yet

> iLearn?

> suggest something else then

> alio Olio?

> suggest some good english words

> Sapling

> not happy with name. sounds irrelevant and meaning less

> describe product

> suggest variation with learn

> not picky

> easyLearning

> LearnEasy

> fullstar?

> Fullstar it is

**Decided:** the app is called **FullStar** — "Lessons from your own school book."

---

## 9. This project folder

> perfect. lets create a separate project for fullstar.  create a document directory and place all documents there. keep a prompts doc as well where you give all original prompts I gave you to create the documents
