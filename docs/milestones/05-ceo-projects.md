# Milestone 5: CEO Agent + Project Support

> Status: **Not Started**
> Goal: The platform is usable end-to-end. Users talk to CEO to build their company.

---

## Tasks

### CEO Agent
- [ ] CEO SOUL.md — admin personality, knows how to hire and manage
- [ ] CEO IDENTITY.md — name, characteristics
- [ ] CEO capabilities (permission grants):
  - [ ] Create agents (generate workspace from template)
  - [ ] Create departments
  - [ ] Assign/reassign roles
  - [ ] Create projects
  - [ ] Manage templates
  - [ ] Delete/deactivate agents
- [ ] Agent creation flow: CEO → template → workspace generation → DB registration → ready

### Agent Templates
- [ ] Default template in `agents/templates/default/`
- [ ] Template rendering (populate SOUL.md/IDENTITY.md from CEO's decisions)
- [ ] `~/.archon/` initialization on first run

### Project Management
- [ ] Project CRUD in registry
- [ ] Methodology selection: waterfall / scrum / kanban
- [ ] Link meetings to projects
- [ ] Methodology influences meeting cadence (scrum = daily standups, kanban = on-demand)

### Decide Phase Polish
- [ ] Proposal submission
- [ ] Voting mechanics (approve / reject / abstain)
- [ ] Vote tallying + decision recording

### Assign Phase Polish
- [ ] Task creation with owner + optional deadline
- [ ] Acknowledgement from assigned agent
- [ ] Action items saved to meeting record

### End-to-End Test
- [ ] `archon init` — creates `~/.archon/` with CEO
- [ ] Talk to CEO: "I want to build X"
- [ ] CEO hires 2-3 agents, assigns departments/roles
- [ ] CEO schedules kickoff meeting
- [ ] Meeting runs through all phases
- [ ] Tasks assigned and acknowledged

---

## Notes
_Add implementation notes, blockers, and discoveries here._

---

## Deliverable
Complete MVP — talk to CEO, build a team, run meetings, get work done.
