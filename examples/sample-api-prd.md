# Task Management API

## Overview

A RESTful API for managing tasks and projects, built with Elysia on Bun. Supports user authentication, project organization, task CRUD, and real-time notifications.

## System Actors

- **End Users** — Interact via web/mobile clients
- **Admin Users** — Manage system configuration
- **Notification Service** — Sends email/push notifications
- **External Calendar API** — Syncs deadlines with Google Calendar

## Architecture

### Containers

- **Elysia API** (Bun) — Primary REST API
- **MongoDB** — Document database for tasks and projects
- **Redis** — Session cache and rate limiting
- **RabbitMQ** — Message queue for async notifications

### Core Services

- **AuthService** — JWT authentication, session management
- **ProjectService** — Project CRUD, membership management
- **TaskService** — Task CRUD, assignment, status transitions
- **NotificationService** — Multi-channel notification dispatch

## Data Model

### User
- id: ULID (primary key)
- email: string (unique)
- name: string
- passwordHash: string
- role: 'admin' | 'member'
- createdAt: Date
- updatedAt: Date

### Project
- id: ULID (primary key)
- name: string
- description: string
- ownerId: ULID (FK -> User)
- members: ULID[] (FK -> User)
- createdAt: Date
- updatedAt: Date

### Task
- id: ULID (primary key)
- title: string
- description: string
- status: 'todo' | 'in-progress' | 'review' | 'done'
- priority: 'low' | 'medium' | 'high' | 'critical'
- projectId: ULID (FK -> Project)
- assigneeId: ULID (FK -> User)
- dueDate: Date
- createdAt: Date
- updatedAt: Date

## API Endpoints

### Auth
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout

### Projects
- GET /api/v1/projects
- POST /api/v1/projects
- GET /api/v1/projects/:id
- PUT /api/v1/projects/:id
- DELETE /api/v1/projects/:id
- POST /api/v1/projects/:id/members

### Tasks
- GET /api/v1/projects/:projectId/tasks
- POST /api/v1/projects/:projectId/tasks
- GET /api/v1/tasks/:id
- PUT /api/v1/tasks/:id
- DELETE /api/v1/tasks/:id
- PATCH /api/v1/tasks/:id/status

## Key Workflows

### Task Creation Flow
1. Client sends POST with task data
2. API validates input with TypeBox
3. TaskService checks project membership
4. Task created in MongoDB
5. Notification sent to assignee via RabbitMQ
6. Calendar event created if dueDate set

### Task Status Transition
1. Client sends PATCH with new status
2. TaskService validates transition (state machine)
3. Task updated in MongoDB
4. Notification sent to project members
5. If status = 'done', calendar event removed

## Infrastructure

- **Deployment**: Docker containers on Azure Container Apps
- **CI/CD**: GitHub Actions
- **Monitoring**: Application Insights
- **Secrets**: Azure Key Vault
