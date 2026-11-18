#!/bin/sh
# Trusted Ocean: private IPFS node. Runs at container start.
# No public bootstrap peers, no public content routing, gateway serves local content only.
set -x
ipfs bootstrap rm --all
ipfs config --json AutoConf.Enabled false || true
ipfs config Routing.Type dht
ipfs config --json Gateway.NoFetch true
ipfs config --json Swarm.RelayClient.Enabled false || true
ipfs config --json Swarm.RelayService.Enabled false || true
ipfs config --json Discovery.MDNS.Enabled false
