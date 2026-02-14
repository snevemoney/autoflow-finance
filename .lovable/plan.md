

# Seed Test Data for Income Calculator Testing

## Overview

Insert a complete set of test records into the database so you can navigate to a deal and test the Income Calculator immediately without creating data through the UI.

## Data to Insert

### 1. Dealer
- **Name**: Metro Auto Group
- **Code**: MAG-001
- **Contact**: John Metro
- **Status**: active

### 2. Customer
- **Name**: Jane Doe
- **Email**: jane.doe@example.com
- **Employer**: Acme Corp
- **Monthly Income**: $5,500

### 3. Vehicle
- **Year/Make/Model**: 2024 Toyota Camry SE
- **VIN**: 1HGCG5655WA041389
- **Condition**: used
- **Invoice Price**: $28,500

### 4. Deal
- **Status**: income_verification (so it appears in the income queue)
- **Loan Amount**: $25,000
- **APR**: 6.9%
- **Term**: 72 months
- **Credit Score**: 680

### 5. Income Sources (3 sources to test all rules)

| Source | Type | Employer | Stated Monthly | Purpose |
|---|---|---|---|---|
| Primary | salaried | Acme Corp | $5,500 | Normal income calc testing |
| Secondary | government_assistance | SSI Benefits | $1,200 | Test analyst benefit percentage review |
| Third | contractor | Uber | $2,000 | Test rideshare auto-detection and ineligibility flag |

## Technical Details

- All records will be inserted using the data insert tool (not migrations, since this is data, not schema)
- UUIDs will be generated and referenced across tables to maintain foreign key relationships
- The deal will have `status = 'income_verification'` so it shows up in the Income Queue
- The Uber income source will have `vehicle_for_work = true` and `verification_status = 'flagged'` to demonstrate the rideshare rule
- The SSI source will have `verification_status = 'needs_review'` to demonstrate the benefits review flow

## No File Changes

This is purely database seeding -- no code modifications needed.

