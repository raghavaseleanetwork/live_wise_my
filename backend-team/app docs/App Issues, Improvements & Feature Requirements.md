# **App Issues, Improvements & Feature Requirements**

## **1\. Google Login**

* Fix Google login functionality.

---

## **2\. Reminder Detail Screen**

* The “Attach Scan” button is not working.  
* Replace the current purple gradient with a simple solid color based on the app logo/theme color.

---

## **3\. Edit Reminder Screen**

* Reminder title alignment issue:  
  * Currently starts from the end.  
  * It should always start from the beginning.  
  * Add proper text fitting, scrolling, or dynamic resizing inside the container.  
* When selecting recurrence options like:  
  * Weekly  
  * Monthly  
    Open a calendar/date selector so the user can choose a specific date.

---

## **4\. Home Screen Data Issues**

* If there is no spending data for the current month, display last month’s spending instead.  
* Ensure the following data is fetched and displayed correctly:  
  * Today’s spending  
  * Daily average  
  * Monthly summary  
  * Other dashboard statistics

---

## **5\. Scan Bill Screen**

* Redesign the Scan Bill UI completely.  
* Current UI is not proper.  
* Add:  
  * Gallery upload option  
  * Better action buttons  
  * Improved overall flow and user experience

---

## **6\. Edit Profile Screen**

### **Issues:**

1. Profile photo upload is failing.  
   * Error shown: “Failed avatar”  
   * Fix upload functionality properly.  
2. Date of Birth field:  
   * Calendar/date picker is not opening on click.  
   * Fix DOB selection flow.

---

## **7\. Voice Reminder Feature**

The voice reminder feature is currently not functioning correctly.

### **Current Issue:**

* “Voice processing failed” error appears.  
* Language detection is not working.

### **Required Fix:**

* Properly detect and process:  
  * English  
  * Hindi  
  * Gujarati  
* The system should respond in the same language spoken by the user.  
* Improve speech recognition accuracy and multilingual support.

---

## **8\. UI Cleanup**

* Remove drop shadows throughout the entire app for a cleaner modern UI.

---

## **9\. Popup Button Issues**

* Multiple popups currently show two Cancel buttons.  
* Keep only one single Cancel button across all popups.  
* Specifically fix the Snooze Reminder popup.

---

## **10\. Money Leak Detection Improvements**

* Add a “How It Works” explanation section.  
* Clearly define which payments are considered money leaks.  
* Important payments and investments should NOT be counted as leaks.  
* Only unnecessary or extra spending should be considered in Money Leak calculations.

---

## **11\. Family Hub System (Major Feature)**

### **Core Concept**

When a user adds a family member, the app should allow selecting multiple management features — not only medicine tracking.

---

### **Add Family Member Flow**

#### **Step 1 – Basic Information**

User enters:

* Name  
* Relation  
* Age

Example:

* Name: Papa  
* Relation: Father  
* Age: 62

---

#### **Step 2 – Feature Selection**

Show:  
“Select what you want to manage for this family member”

Allow multi-select.

---

### **Available Feature Options**

#### **1\. Medicine Tracking 💊**

* Daily reminders  
* Adherence tracking

#### **2\. Doctor Appointments 🏥**

* Appointment reminders  
* Follow-ups

#### **3\. Bill Management 💡**

* Electricity bills  
* Medical bills  
* Insurance payments

#### **4\. Health Monitoring ❤️**

* Blood pressure tracking  
* Sugar tracking  
* Weight tracking

#### **5\. Emergency Alerts 🚨**

* Notify family if medicine is missed  
* SOS alerts

#### **6\. Daily Routine 🕒**

* Wake-up reminders  
* Sleep reminders  
* Walking schedule

#### **7\. Subscription Tracking 📺**

* OTT subscriptions  
* Service renewals

#### **8\. Expense Tracking 💰**

* Personal expense tracking  
* Spending alerts

#### **9\. Reminder Tasks 📋**

* Daily tasks  
* Custom reminders

#### **10\. Call & Check-in 📞**

* Call reminders  
* Daily check-in reminders

#### **11\. Travel & Visits ✈️**

* Doctor visits  
* Family visit reminders

#### **12\. Medication Stock 📦**

* Refill reminders  
* Low stock alerts

#### **13\. Diet & Food 🍽️**

* Meal reminders  
* Diet schedules

#### **14\. Insurance & Documents 📄**

* Policy reminders  
* Document tracking

#### **15\. Custom Feature ⚙️**

* User-defined tracking options

---

## **12\. Family Feature Logic**

### **Feature Selection Storage**

Example:

{  
  "member\_id": "123",  
  "features": \["medicine", "bills", "health", "emergency"\]  
}

---

### **Dynamic UI Generation**

Only selected modules should appear.

Example:  
If the user selects:

* Medicine  
* Bills

Show:

* Medicine reminders  
* Bill reminders

Hide all unrelated modules.

---

### **Family Member Dashboard**

Each member should have a separate dynamic dashboard.

Example:

Papa Dashboard

* Medicine: 2 reminders  
* Bills: 1 due  
* Health: BP log

---

### **Reminder Integration**

All selected features should connect with the reminder engine.

Examples:

* Medicine → daily reminders  
* Bills → due reminders  
* Calls → check-in reminders

---

### **Emergency Logic**

If enabled:

* Notify family when medicine is missed.  
* Send alerts if no activity is detected.

---

### **Caregiver Logic**

If the member is a parent:

* Automatically enable caregiver alerts.

---

---

## **14\. Reports Screen Improvements**

* Allow users to download reports as PDF.  
* Support filters:  
  * Today  
  * Weekly  
  * Monthly  
  * 3 Months  
  * 6 Months  
  * Yearly  
  * Custom month combinations  
* Generate premium-looking PDF reports with:  
  * Beautiful UI  
  * Charts  
  * Graphs  
  * Statistics

---

## **15\. Overdue Alert Issue**

On the Home Screen:

* If the user cancels or dismisses an Overdue Alert, it should not appear again.  
* If the user snoozes the alert, it should stay hidden until the snooze duration ends.

---

**16\. All whole app bugs find and fix** 

