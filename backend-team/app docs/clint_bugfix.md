LifeWise – Change Requests & Bug Fixes (According to PRD)
1. Credit / Debit Transaction Detection
Issue
Currently, transactions are not being correctly identified as Credit or Debit.
Required Changes
Automatically detect whether a transaction is Credit or Debit.
Display the correct transaction type throughout the application.
Ensure all calculations (income, expenses, balance, analytics, reports) use the correct transaction type.
Apply consistent color coding:
Credit (Income): Green
Debit (Expense): Red


2. Activity Section Improvements
Required Changes
Reduce the Activity title size to match the overall UI hierarchy.
Properly categorize all activities into Credit and Debit.
Display Credit transactions in Green.
Display Debit transactions in Red.
Issue
The current title "Total" is unclear and does not accurately represent the displayed data in home screen.
Required Changes
Rename "Total" to a more meaningful title.




3. Home Dashboard Improvements
Required Changes
Rename "Total" to "Total Transactions".
Display the total number of transactions correctly.
Make the Finance Summary Box full width inside its container.


4. UI Consistency Across the App
Required Changes
Review all screens.
Fix inconsistent:
Card widths
Row spacing
Padding
Margins
Component alignment
Maintain consistent design according to the design system.

5. Add "Other Expense" Category (Leaks Logic)
Required Changes
Add a new expense category:
Other Expense
If the user transfers money to another person or records an expense that should not be considered a financial leak, it should be categorized as Other Expense.
Ensure these transactions are excluded from Leaks Analysis.
This feature was discussed during the project meeting.


6. Caregiver Email Invitation
Required Changes
Integrate caregiver invitation via email.
When a caregiver invite is sent, the recipient should receive a properly formatted invitation email.
Verify the complete invitation flow is working successfully.
7. Amount Display
Required Changes
If the amount exceeds the available width of the small summary card, enable horizontal scrolling or marquee behavior.
Ensure the amount never breaks the layout or overlaps other UI elements.


8. Settings Enhancements
Required Changes
Add Language Settings to the Settings/Profile screen.
Allow users to change the app language.
Add Payment History under the Subscription section.
Display all subscription payments with relevant details.
9. Biometric Authentication
Required Changes
Integrate biometric authentication.
Support:
Face ID
Fingerprint
Allow users to enable or disable biometric login from the app Settings.
10. Voice Reminder Language Issues 
Issue
Voice recognition is not working consistently across supported languages.
Required Changes
Verify and fix voice reminder recognition for all supported languages.
Gujarati voice recognition is currently not working.
Hindi recognition is inconsistent and sometimes fails.
Test and validate language detection thoroughly for all supported languages.
11. Caregiver Permissions & Access
Required Changes
Implement the caregiver role as defined in the PRD.
Permissions
Receive reminder notifications and alerts.
Mark reminders as completed.
Access only the data and permissions assigned by the primary account holder.

12. Family Reminders Section (Home Dashboard)


Reminder Card Should Display
Member profile photo
Member name
Reminder type icon
Reminder title
Reminder time
Reminder Status
Navigation
Add a View All button small 
Navigate to the Reminders tab.

13. Upcoming Bills & Due Dates

Display
Show the next 3–5 upcoming:
Bills
Appointments
Renewals
Only include items due within the next 7 days.
Each Item Should Display
Icon
Title
Due Date
Member Name
Status Colors
🟢 Green → Due in 3+ days
🟠 Orange → Due in 1–2 days
🔴 Red → Due Today / Overdue

14. Add Missing Fields in "Add Family Member"
Required Changes
The following fields are currently missing when adding a family member:
Age
Blood Group

15. Family Hub – Missing PRD Fields
Required Changes
The Family Hub module currently does not match the PRD specifications.
Required Action
Review all 20 Family Hub modules against the PRD.
Add all missing fields, inputs, sections, and functionalities.
Ensure every field mentioned in the PRD is implemented.
Maintain consistency with the approved UI/UX and functional requirements.

16. Check this - all working or not and add and fix


** Final PRD Verification**
Required Changes
Before final delivery:
Verify every screen against the PRD.
Ensure no mandatory field or functionality is missing.
Perform complete end-to-end testing.
Fix all UI, UX, functional, and responsive issues.
Ensure consistency across Android and iOS platforms.
Deliver the application fully aligned with the approved PRD.
***General Testing & Bug Fixes***
Required Changes
Perform complete regression testing.
Verify all modules against the PRD.
Fix any UI, functionality, responsiveness, and performance issues found during testing.
Ensure all features work consistently across Android and iOS devices.


16. Check this - all working or not and add and fix

6. Reminders Tab - Engine & Logic

6.1 Reminder Tab Overview

The Reminders tab shows ALL reminders across ALL family members in one unified view. This
is the reminder command center.

Filter Bar (Horizontal Scroll)
. All - Show all reminders across all members
. Today - Only today's reminders
. Upcoming -Reminders due in next 7 days
Overdue - Missed, not completed
. Completed - Done today / this week
. Per Member filters - Papa, Mummy, etc. (user's family members)

Reminder Card Components
. Module icon (medicine, bill, etc.)
Member avatar + name
. Reminder title
Due time / due date
. Status badge - Pending / Done / Missed / Snoozed
. Quick action buttons - Mark Done, Snooze, Edit

6.2 Reminder Lifecycle
8. Reminder created (manual or via module setup)
9. Stored in DB with status: PENDING
10. At scheduled time: FCM push notification sent to member + caregivers
11. Notification has action buttons: Mark Done / Snooze / Skip
12. If user taps Mark Done: status + COMPLETED, all caregivers sync
13. If user taps Snooze: status stays PENDING, new notification scheduled in X minutes
14. If no action in 30 minutes: status -+ MISSED, alert sent to caregivers
15. Missed reminders shown in red on Reminders tab and Home screen
16. End of day: daily summary push notification -'3 reminders missed today'


8. Profile Tab - Settings & Permissions

8.1 Account Section
. Profile photo, name, email, phone
. Edit profile
. Change password
. Linked accounts (Google, Apple)

8.2 Notification Settings
. Master notification toggle
. Per-module notification toggle: Medicine, Bills, Insurance, Doctor, Diet, Routine, Travel,
Custom, SOS
. Quiet hours - Set do-not-disturb time range
. Notification sound preference

8.3 Family Permissions
. Who can manage which member - Caregiver assignment UI
. Permission levels: View Only / Can Edit / Full Access
. Connected devices list
. Pending invites (if invite system added)

.

.

8.4 App Settings
. Language - English, Hindi, Gujarati, Marathi, Tamil, Telugu, Bengali
. Dark mode toggle
. Currency - INR (default), changeable
Biometric lock - Touch ID / Face ID
Data export - Export all family data as JSON

8.5 Subscription
. Current plan: Free / Premium
. What's included in each plan - Feature comparison table
Upgrade CTA
Payment history
Cancel subscription


10. Real-Time Sync & Notification System

10.1 Firebase FCM - Push Notification Architecture
. Every user has an FCM token stored in DB on login
. Token refreshed automatically by Firebase SDK
. Notification payloads include: reminder_id, member_id, action_type
. iOS: Requires explicit permission request via react-native-permissions
. Android: Foreground service + exact alarm scheduling for medicine reminders

10.2 Notification Types & Payloads


10.3 WebSocket Real-Time Sync (Socket.io)

Used for instant sync when a caregiver takes action on a shared reminder.
. Room: Each family group has a socket room (family_group_id)
. On Mark Done: Server emits REMINDER_UPDATED event to all room members
. All clients update local state immediately
. Fallback: If WebSocket disconnected, poll API every 30 seconds

10.4 iOS-Specific Implementation

. Use react-native-permissions for notification permission
. Background notifications: background_fetch + silent push
UNUserNotificationCenter for local notification scheduling
. Critical alerts (SOS): requires Apple entitlement
Notification categories with action buttons registered at app launch

10.5 Android-Specific Implementation
. Foreground Service for medicine reminders - runs even when app killed
. AlarmManager (exact alarms) - requires SCHEDULE_EXACT_ALARM permission
. Battery optimization: prompt user to whitelist app in battery settings
. Notification channels - create separate channels per module for granular control


** Final PRD Verification **

Required Changes

Before final delivery:

. Verify every screen against the PRD.
. Ensure no mandatory field or functionality is missing.
. Perform complete end-to-end testing.
. Fix all UI, UX, functional, and responsive issues.
. Ensure consistency across Android and iOS platforms.
. Deliver the application fully aligned with the approved PRD.

*** General Testing & Bug Fixes ***

Required Changes
. Perform complete regression testing.
. Verify all modules against the PRD.
. Fix any UI, functionality, responsiveness, and performance issues found during testing.
. Ensure all features work consistently across Android and iOS devices.