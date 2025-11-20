# How Maintenance Mode Works

This document explains the GenU maintenance mode system for non-technical users and contributors.

## What is Maintenance Mode?

Maintenance mode is a system feature that allows administrators to temporarily display a maintenance page to all users while performing system updates, fixes, or improvements. During this time, the application is unavailable to regular users, but administrators can still access it to verify changes.

## Why Do We Need It?

Sometimes we need to:
- Update the system with new features
- Fix important bugs or security issues
- Perform database migrations
- Test major changes before making them available to everyone

Instead of showing error messages or leaving the site broken during these updates, maintenance mode displays a clear, professional message explaining that the system is temporarily unavailable.

## What You'll See

### For Regular Users

When maintenance mode is active, you'll see:
- A clean maintenance page explaining that the system is being updated
- A message saying "We'll be back online shortly"
- Contact information for urgent inquiries

The page will have:
- The GenU branding and colors
- A simple, easy-to-read design
- Works on all devices (desktop, tablet, mobile)

### For Administrators

If your IP address is whitelisted, you'll continue to see and use the normal application even during maintenance. This allows administrators to:
- Verify that updates are working correctly
- Test new features before enabling for everyone
- Fix any issues that arise during maintenance

## How It Works (Simple Explanation)

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  You visit the GenU website                     │
│                                                 │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│                                                 │
│  Is maintenance mode ON?                        │
│                                                 │
├─────────────────────────────────────────────────┤
│  NO  → You see the normal application           │
│                                                 │
│  YES → Are you an administrator?                │
│        ├─ YES → You see the normal application  │
│        └─ NO  → You see the maintenance page    │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Technical Overview (For Interested Users)

The system works using several components:

### 1. CloudFront (Content Delivery Network)
Acts as the "front door" to the application. When you visit the website, your request goes through CloudFront first.

### 2. CloudFront Functions
Small, fast programs that run at CloudFront edge locations (servers close to you geographically). These functions check:
- Is maintenance mode currently active?
- Is your IP address whitelisted (are you an administrator)?
- Should we show you the maintenance page or the application?

### 3. KeyValueStore
A simple database that stores two pieces of information:
- **maintenance**: Is maintenance mode on or off? (`true` or `false`)
- **ipWhitelist**: List of administrator IP addresses allowed during maintenance

### 4. S3 Bucket
Cloud storage that holds the maintenance page files (HTML and CSS).

### How Fast Is It?

- **Activation Time**: Less than 1 minute
  - Administrators change a single value in the KeyValueStore
  - The change propagates to all CloudFront edge locations worldwide
  - Users start seeing the maintenance page within 30-60 seconds

- **Performance Impact**: Negligible
  - CloudFront Functions run in less than 1 millisecond
  - No noticeable difference in page load times

- **Comparison**: Traditional Method
  - Old way: Redeploy entire application (10+ minutes)
  - New way: Change one value (< 1 minute)

## Data Flow Diagram

```
User Request
    │
    ▼
┌───────────────────────────────────────┐
│   CloudFront Edge Location            │
│                                       │
│   ┌──────────────────────────────┐   │
│   │ ViewerRequest Function       │   │
│   │                              │   │
│   │ 1. Check KeyValueStore       │   │
│   │    - maintenance = true?     │   │
│   │    - Is IP whitelisted?      │   │
│   │                              │   │
│   │ 2. Make decision:            │   │
│   │    - Show maintenance page   │   │
│   │    - OR show application     │   │
│   └──────────────────────────────┘   │
│                                       │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│ Response                              │
│                                       │
│ Maintenance Page (503 status)        │
│ OR                                    │
│ Normal Application (200 status)      │
│                                       │
└───────────────────────────────────────┘
```

## Security & Privacy

### IP Address Checking
- The system checks your IP address to determine if you're an administrator
- This is standard web technology - every website can see IP addresses
- IP addresses are not logged or stored permanently
- They're only used for the immediate access decision

### Data Privacy
- Maintenance mode does not access any user data
- No personal information is collected or processed
- The system only checks: maintenance status and IP address

### Reliability
- **Fail-Safe Design**: If anything goes wrong with the maintenance mode system, it automatically allows traffic through
- This means a maintenance mode bug won't break the entire website
- Users will see the normal application if the maintenance system fails

## Common Scenarios

### Scenario 1: Scheduled Maintenance
1. Administrator announces maintenance window (e.g., "System will be down Saturday 2 AM - 4 AM")
2. At 2 AM, administrator activates maintenance mode
3. Users see maintenance page
4. Administrator performs updates and tests
5. At 4 AM, administrator deactivates maintenance mode
6. Users can access the application again

### Scenario 2: Emergency Fix
1. Critical bug discovered in production
2. Administrator activates maintenance mode immediately
3. All users see maintenance page (except whitelisted admins)
4. Administrator deploys fix and verifies it works
5. Administrator deactivates maintenance mode
6. Users access the fixed application

### Scenario 3: Gradual Rollout
1. Administrator deploys new feature
2. Activates maintenance mode for all users
3. Whitelisted admins test the new feature
4. After verification, deactivates maintenance mode
5. New feature is now available to everyone

## Frequently Asked Questions

### Q: How long does maintenance usually take?
**A**: Most maintenance windows are 1-4 hours. The exact duration depends on what's being updated. Administrators announce expected duration when possible.

### Q: Will I lose my work during maintenance?
**A**: If you're actively using the application when maintenance mode activates, you may lose unsaved work. The system cannot preserve in-progress sessions. Save your work frequently, especially if maintenance is announced.

### Q: Can I access the application at all during maintenance?
**A**: Regular users cannot access the application. Only administrators with whitelisted IP addresses can access it during maintenance mode.

### Q: How do I know if maintenance is planned?
**A**: Administrators typically announce planned maintenance in advance via email, internal communications, or system notifications.

### Q: What if I see the maintenance page unexpectedly?
**A**: If you see the maintenance page without prior notice:
1. Wait a few minutes and try again (might be a brief emergency fix)
2. Check your email or internal communications for announcements
3. If it persists, contact support

### Q: Does the maintenance page work on mobile devices?
**A**: Yes, the maintenance page is fully responsive and works on all devices - smartphones, tablets, and desktop computers.

### Q: Can I bookmark the maintenance page?
**A**: You can, but it's not useful. The maintenance page URL is the same as the application URL. When maintenance mode is deactivated, that URL will show the normal application again.

### Q: What does "503 Service Unavailable" mean?
**A**: It's a standard HTTP status code that tells your browser "the service is temporarily unavailable but will be back." It's the correct code to use for planned maintenance.

## Benefits of This System

1. **Faster Activation**: Under 1 minute vs 10+ minutes
2. **Better User Experience**: Professional maintenance page instead of error messages
3. **Admin Access**: Administrators can verify fixes during maintenance
4. **Reduced Risk**: Less chance of human error during maintenance
5. **Global Reach**: Works consistently for users worldwide

## Learn More

For technical details and operational procedures, see:
- [Maintenance Mode Operations Guide](./MAINTENANCE_MODE.md) - For operators and administrators
- Developer documentation in README or CONTRIBUTING.md - For developers

## Support

If you have questions about the maintenance mode system:
- Contact your system administrator
- Check internal documentation
- Reach out to the support team
