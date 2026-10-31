#!/usr/bin/env bash
# Run manually from the repository root in Cloud Shell or Bash with gcloud.
# This creates billable infrastructure. It does not configure application secrets.
set -euo pipefail

: "${GCP_PROJECT:?Export GCP_PROJECT before running this script}"
GCP_REGION="${GCP_REGION:-europe-west3}"
GCP_ZONE="${GCP_ZONE:-europe-west3-a}"
VM_NAME="${VM_NAME:-spoti-chan}"
NETWORK="${VM_NAME}-network"
SUBNET="${VM_NAME}-subnet"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

gcloud services enable compute.googleapis.com iap.googleapis.com --project="$GCP_PROJECT"
gcloud compute networks create "$NETWORK" --subnet-mode=custom --project="$GCP_PROJECT"
gcloud compute networks subnets create "$SUBNET" --network="$NETWORK" \
  --region="$GCP_REGION" --range=10.42.0.0/24 --project="$GCP_PROJECT"
gcloud compute firewall-rules create "${VM_NAME}-web" --network="$NETWORK" \
  --allow=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 \
  --target-tags=spoti-chan --project="$GCP_PROJECT"
gcloud compute firewall-rules create "${VM_NAME}-iap-ssh" --network="$NETWORK" \
  --allow=tcp:22 --source-ranges=35.235.240.0/20 \
  --target-tags=spoti-chan --project="$GCP_PROJECT"
gcloud compute addresses create "${VM_NAME}-ip" --region="$GCP_REGION" --project="$GCP_PROJECT"
IP_ADDRESS="$(gcloud compute addresses describe "${VM_NAME}-ip" --region="$GCP_REGION" \
  --format='value(address)' --project="$GCP_PROJECT")"
gcloud compute instances create "$VM_NAME" --project="$GCP_PROJECT" --zone="$GCP_ZONE" \
  --machine-type=e2-small --network="$NETWORK" --subnet="$SUBNET" --address="$IP_ADDRESS" \
  --image-project=ubuntu-os-cloud --image-family=ubuntu-2404-lts-amd64 \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced --tags=spoti-chan \
  --no-service-account --shielded-secure-boot --metadata=enable-oslogin=TRUE \
  --metadata-from-file="startup-script=${SCRIPT_DIR}/startup.sh"

printf '\nVM created. Set a DNS A record to %s, then follow docs/DEPLOYMENT.md.\n' "$IP_ADDRESS"
printf 'SSH: gcloud compute ssh %s --project=%s --zone=%s --tunnel-through-iap\n' \
  "$VM_NAME" "$GCP_PROJECT" "$GCP_ZONE"
