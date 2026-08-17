# 7 Seasons - Product Vision & Functional Overview

## Executive Summary

7 Seasons is an AI-powered Marriage Operating System designed to help couples navigate every major season of marriage, from engagement through retirement.

Unlike traditional dating, compatibility, or counseling tools, 7 Seasons is not designed to determine whether two people should be together. Instead, it helps couples understand themselves, understand each other, anticipate future challenges, and develop healthier responses throughout the lifecycle of their relationship.

The system begins by creating a deep understanding of each individual through structured AI-guided conversations. It then creates a relationship model representing the marriage itself. Over time, this model evolves as the couple moves through different life seasons.

The long-term vision is for 7 Seasons to become a trusted relationship companion that helps couples prepare for future seasons, navigate conflict, make major life decisions, and strengthen their marriage proactively rather than reactively.

---

# Core Product Principles

## Principle 1: Marriage Is Dynamic

Most compatibility systems evaluate people at a single point in time.

7 Seasons assumes marriages evolve.

The platform should focus on trajectory, growth, adaptation, and season-specific challenges rather than static compatibility scores.

---

## Principle 2: Understanding Before Advice

The platform should deeply understand both spouses before providing recommendations.

Advice should be personalized to the specific relationship.

The same event (having a baby, changing jobs, moving, conflict) may require entirely different guidance depending on the individuals involved.

---

## Principle 3: Forecasting Rather Than Reacting

Most relationship tools solve current problems.

7 Seasons should proactively identify future risks and opportunities before they become major issues.

---

# Phase 1: Relationship Discovery Engine

## Objective

Create a comprehensive profile of each individual.

The discovery process should feel like natural conversation rather than questionnaire completion.

Expected completion time: 5–10 hours per individual.

---

## Discovery Domains

### Childhood & Attachment
- Family environment
- Attachment style
- Conflict modeling
- Emotional safety
- Discipline experiences

### Faith & Spiritual Formation
- Spiritual maturity
- Prayer habits
- Church involvement
- Theology of marriage
- Expectations of spiritual leadership

### Family Vision
- Children
- Parenting
- Extended family boundaries
- Family culture
- Household priorities

### Conflict & Repair
- Escalation patterns
- Withdrawal patterns
- Forgiveness
- Ownership
- Repair behavior

### Communication
- Directness
- Processing style
- Emotional expression
- Listening tendencies

### Money & Stewardship
- Spending philosophy
- Saving philosophy
- Debt views
- Generosity
- Risk tolerance

### Calling & Ambition
- Life mission
- Career goals
- Service orientation
- Desired lifestyle

### Intimacy & Sexuality
- Theology of intimacy
- Affection needs
- Sexual expectations
- Sexual growth mindset

### Expectations of Marriage
- Roles
- Responsibilities
- Decision making
- Household management
- Leadership expectations

### Growth Mindset
- Beliefs about change
- Commitment
- Resilience
- Marriage development

---

# Phase 2: Relationship DNA Framework

The AI should convert conversation data into structured dimensions.

Examples:
- Faith Commitment
- Conflict Avoidance
- Need for Reassurance
- Financial Conservatism
- Need for Physical Affection
- Emotional Expressiveness
- Decision Ownership
- Family Orientation
- Career Ambition
- Risk Tolerance
- Forgiveness Speed
- Conflict Recovery Time

Expected size: 50–100 dimensions.

---

# Phase 3: Marriage Model

After both profiles are completed, create a third model: The Marriage.

This is not simply Person A + Person B.

The Marriage Model identifies:
- Strengths
- Growth Areas
- Potential Friction Points
- Shared Values
- Seasonal Vulnerabilities
- Seasonal Strengths

---

# Phase 4: Marriage Trajectory Report

The Trajectory Report is the onboarding deliverable. It replaces traditional compatibility scores.

The report projects likely experiences across the seven seasons of marriage.

| Season | Name |
|--------|------|
| Season 1 | Engagement & Newlyweds |
| Season 2 | Building a Home |
| Season 3 | Young Children |
| Season 4 | School-Age Children |
| Season 5 | Teenagers |
| Season 6 | Empty Nest |
| Season 7 | Legacy & Retirement |

For each season provide:
- Expected Strengths
- Expected Challenges
- Recommended Conversations
- Recommended Habits
- Counselor Discussion Topics

---

# Phase 5: Living Marriage Operating System

After onboarding, the product becomes an ongoing marriage companion.

## Feature: Season Transition Guidance
Example: "We are having our first baby."
The AI provides personalized guidance based on both profiles — potential misunderstandings, likely stress responses, practical preparation, conversation prompts.

## Feature: Marriage Check-In
Quarterly or monthly relationship review tracking:
- Connection
- Conflict
- Intimacy
- Spiritual health
- Family stress
- Life satisfaction

## Feature: Big Decision Advisor
Examples: moving, career changes, homeschooling, financial decisions, adoption, retirement.
The AI helps each spouse understand how the other is likely approaching the decision.

## Feature: We Are Arguing (Potential Flagship)
1. Husband explains issue
2. Wife explains issue
3. AI compares against relationship history
4. AI identifies recurring patterns
5. AI helps each spouse understand the other

Goal: Understanding before resolution. Not determining who is right.

## Feature: We Feel Stuck
The AI analyzes current season and relationship history, providing:
- Connection exercises
- Conversation prompts
- Growth recommendations
- Relationship goals

## Feature: Marriage Timeline
Track major events over decades: marriage, children, moves, career changes, health challenges, losses, retirement.
The relationship model evolves alongside the timeline.

---

# Potential Long-Term Expansion

- Premarital Counseling
- Church Licensing
- Counselor Dashboard
- Pastoral Dashboard
- Marriage Coaching Marketplace
- Marriage Health Analytics
- Church-Level Marriage Health Reporting

---

# Core Design Decisions

## Faith Agnostic
The platform is faith agnostic. Spiritual dimensions are captured but not assumed.

## Reports for Counselors / Pastors
Reports must be available for counselors and pastors in a professional format.

## Hide Raw Scores — Show Insights

**Couple-facing view:**
- Strengths
- Growth Areas
- Seasonal Forecast

**Counselor-facing view:**
- Dimensions
- Trends
- Patterns
- Raw scoring (optional)

The scores exist internally. The narrative is exposed externally.

## Role Definition: Relationship Guide + Coaching Assistant

Never position the AI as:
- Therapist
- Psychologist
- Diagnostician
- Counselor

Instead of: "Here's what's wrong with your spouse."
Say: "Here's what your spouse may be experiencing."

**On escalation:** If concerning content is shared, the AI should surface:
- Crisis hotline information
- Domestic violence resources
- Emergency services information
- Encouragement to contact trusted people

## Primary User: Couples First
While counselors, pastors, and coaches are valuable distribution channels, the primary user experience is designed for couples directly.

This shapes: architecture, onboarding flow, permissions model, and pricing strategy.

---

# Voice Strategy

## Philosophy

The voice experience in 7 Seasons should feel intentional, not constant. The goal is not to have the founder narrate the application — it is to build trust, familiarity, and emotional connection at the moments that matter most. Users should recognize that certain moments carry greater significance because they hear the founder's voice.

**Guiding Principle:** Reserve the founder's voice for moments of significance. Routine coaching should feel helpful. Milestones should feel personal.

---

## Two-Voice Architecture

### Founder Voice (Sydney)

The cloned founder voice is reserved for high-significance touchpoints where presence and personal connection matter:

- Initial onboarding and welcome experience
- Explaining the vision and purpose of 7 Seasons
- Transitioning a couple between life seasons
- Major milestone celebrations
- Difficult conversations requiring empathy
- Premium educational lessons
- Special holiday and seasonal messages
- Annual relationship reflections
- Feature introductions from the founder

These messages should be intentionally scripted and stored as reusable audio assets whenever possible.

### AI Coach Voice

A high-quality ElevenLabs voice represents the AI Coach — not the founder. This voice handles the day-to-day relationship work:

- Daily coaching and encouragement
- Q&A and recommendations
- Reports and assessments
- Habit tracking and routine motivation
- Dynamic, responsive conversations

The distinction matters: the AI Coach is the system's ongoing presence. The founder is a recognizable guide who appears at pivotal moments.

---

## Audio Architecture

The storage-first principle keeps TTS costs low while maintaining production quality:

1. Generate founder recordings once.
2. Store the resulting audio files.
3. Stream the stored audio rather than regenerating it.

New founder audio is only generated when content changes or when a personalized message delivers exceptional value. AI Coach responses remain dynamic and generated on demand.

---

## Brand Philosophy

The founder's voice should become a recognizable signature of the 7 Seasons experience — like a keynote speaker who addresses an audience at meaningful moments rather than every moment. This approach:

- Preserves the authenticity and weight of the founder's voice
- Increases perceived value by not overexposing it
- Allows the AI Coach to handle day-to-day interactions at scale

---

## Future Vision

As the platform grows, users may choose from multiple AI coaching voices. The founder's voice remains the consistent anchor — introducing major experiences, celebrating milestones, and framing the platform's vision. The result is an experience that scales without losing the human connection that differentiates 7 Seasons from every other relationship tool.

---

# Success Metric

The primary objective is not matching people.

The primary objective is helping couples thrive through every season of marriage.

The product should answer:

> "What should we understand about ourselves and our relationship before the next season arrives?"
